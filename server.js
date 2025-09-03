import express from 'express';
import cors from 'cors';
import { Telegraf } from 'telegraf';
import { createPool } from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configuración de MySQL
const pool = createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  port: process.env.MYSQL_PORT || 3306,
  acquireTimeout: 5000,
  timeout: 5000,
  queueLimit: 0,
  acquireTimeout: 5000,
  timeout: 5000,
  connectTimeout: 5000,
  reconnect: true,
  ssl: false
});

// Función para verificar conexión MySQL
async function verificarConexionMySQL() {
  try {
    await pool.execute('SELECT 1');
    return true;
  } catch (error) {
    console.error('❌ Error conectando a MySQL:', error.code || error.message);
    return false;
  }
}

// Datos de ejemplo como fallback
const datosEjemplo = {
  Clientes: [
    { cliente_id: 1, nombre: 'Cliente Demo 1', lista: 1, localidad: 'Centro' },
    { cliente_id: 2, nombre: 'Cliente Demo 2', lista: 2, localidad: 'Norte' }
  ],
  Categorias: [
    { categoria_id: 1, categoria_nombre: 'Bebidas' },
    { categoria_id: 2, categoria_nombre: 'Snacks' }
  ],
  Productos: [
    { producto_id: 1, categoria_id: 1, producto_nombre: 'Coca Cola', precio1: 100, precio2: 95, precio3: 90, precio4: 85, precio5: 80, activo: 'SI' },
    { producto_id: 2, categoria_id: 2, producto_nombre: 'Papas Fritas', precio1: 50, precio2: 48, precio3: 45, precio4: 42, precio5: 40, activo: 'SI' }
  ]
};

// Bot de Telegram
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN || 'dummy_token');

// Estado del usuario (en memoria - en producción usar base de datos)
const userStates = new Map();
const userCarts = new Map();
const searchStates = new Map();

// Funciones auxiliares
function getUserState(userId) {
  return userStates.get(userId) || { step: 'idle' };
}

function setUserState(userId, state) {
  userStates.set(userId, state);
}

function getUserCart(userId) {
  return userCarts.get(userId) || [];
}

function setUserCart(userId, cart) {
  userCarts.set(userId, cart);
}

function getSearchState(userId) {
  return searchStates.get(userId) || {};
}

function setSearchState(userId, state) {
  searchStates.set(userId, state);
}

// Función para obtener datos de MySQL
async function obtenerDatosMySQL(tabla) {
  // Verificar conexión primero
  const conexionDisponible = await verificarConexionMySQL();
  if (!conexionDisponible) {
    console.log(`⚠️ MySQL no disponible, usando datos de ejemplo para ${tabla}`);
    return datosEjemplo[tabla] || [];
  }

  try {
    console.log(`📊 Obteniendo datos de MySQL: ${tabla}...`);
    
    let query;
    switch (tabla) {
      case 'Clientes':
        query = 'SELECT cliente_id, nombre, lista, localidad FROM Clientes ORDER BY nombre';
        break;
      case 'Categorias':
        query = 'SELECT categoria_id, categoria_nombre FROM Categorias ORDER BY categoria_nombre';
        break;
      case 'Productos':
        query = 'SELECT producto_id, categoria_id, producto_nombre, precio1, precio2, precio3, precio4, precio5, activo FROM Productos WHERE activo = "SI" ORDER BY producto_nombre';
        break;
      case 'Pedidos':
        query = 'SELECT pedido_id, fecha_hora, cliente_id, cliente_nombre, items_cantidad, total, estado, observacion FROM Pedidos ORDER BY fecha_hora DESC';
        break;
      case 'DetallePedidos':
        query = 'SELECT detalle_id, pedido_id, producto_id, producto_nombre, categoria_id, cantidad, precio_unitario, importe, observaciones FROM DetallePedidos ORDER BY pedido_id, detalle_id';
        break;
      default:
        throw new Error(`Tabla no reconocida: ${tabla}`);
    }
    
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.execute(query);
      console.log(`✅ ${tabla}: ${rows.length} registros obtenidos`);
      return rows;
    } finally {
      connection.release();
    }
    
  } catch (error) {
    console.error(`❌ Error obteniendo datos de ${tabla}:`, error.code || error.message);
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      console.error('🔌 Problema de conexión con MySQL. Verifica la configuración de red.');
      console.log(`⚠️ Usando datos de ejemplo para ${tabla}`);
      return datosEjemplo[tabla] || [];
    }
    return datosEjemplo[tabla] || [];
  }
}

// Función para agregar datos a MySQL
async function agregarDatosMySQL(tabla, datos) {
  try {
    console.log(`📝 Agregando datos a MySQL: ${tabla}...`);
    
    let query;
    let values;
    
    switch (tabla) {
      case 'Pedidos':
        query = `INSERT INTO Pedidos (pedido_id, fecha_hora, cliente_id, cliente_nombre, items_cantidad, total, estado, observacion) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        values = datos;
        break;
      case 'DetallePedidos':
        query = `INSERT INTO DetallePedidos (detalle_id, pedido_id, producto_id, producto_nombre, categoria_id, cantidad, precio_unitario, importe, observaciones) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        values = datos;
        break;
      default:
        throw new Error(`Tabla no soportada para inserción: ${tabla}`);
    }
    
    const connection = await pool.getConnection();
    try {
      await connection.execute(query, values);
      console.log(`✅ Datos agregados a ${tabla} exitosamente`);
      return true;
    } finally {
      connection.release();
    }
    
  } catch (error) {
    console.error(`❌ Error agregando datos a ${tabla}:`, error.code || error.message);
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
      console.error('🔌 Problema de conexión con MySQL. Verifica la configuración de red.');
    }
    return false;
  }
}

// Función para calcular precio según lista del cliente
function calcularPrecio(producto, listaCliente) {
  const precioKey = `precio${listaCliente}`;
  return producto[precioKey] || producto.precio1 || 0;
}

// Función para generar ID de pedido autoincremental
async function generarPedidoId() {
  try {
    console.log('🔢 Generando nuevo ID de pedido...');
    
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.execute(
        'SELECT pedido_id FROM Pedidos WHERE pedido_id LIKE "PD%" ORDER BY pedido_id DESC LIMIT 1'
      );
      
      let ultimoNumero = 0;
      if (rows.length > 0) {
        const ultimoPedidoId = rows[0].pedido_id;
        if (ultimoPedidoId && ultimoPedidoId.startsWith('PD')) {
          ultimoNumero = parseInt(ultimoPedidoId.replace('PD', ''));
        }
      }
      
      const nuevoNumero = ultimoNumero + 1;
      const nuevoPedidoId = `PD${String(nuevoNumero).padStart(6, '0')}`;
      
      console.log(`✅ Nuevo ID generado: ${nuevoPedidoId}`);
      return nuevoPedidoId;
      
    } finally {
      connection.release();
    }
    
  } catch (error) {
    console.error('❌ Error generando ID:', error.code || error.message);
    return `PD${String(Date.now()).slice(-6).padStart(6, '0')}`;
  }
}

// Función para agrupar clientes por localidad
function agruparClientesPorLocalidad(clientes) {
  const agrupados = {};
  
  clientes.forEach(cliente => {
    const localidad = cliente.localidad || 'Sin localidad';
    if (!agrupados[localidad]) {
      agrupados[localidad] = [];
    }
    agrupados[localidad].push(cliente);
  });
  
  return agrupados;
}

// Comandos del bot
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const userName = ctx.from.first_name || 'Usuario';
  
  console.log(`🚀 Usuario ${userName} (${userId}) inició el bot`);
  
  setUserState(userId, { step: 'idle' });
  setUserCart(userId, []);
  
  const mensaje = `¡Hola ${userName}! 👋\n\n🛒 Bienvenido al sistema de pedidos\n\n¿Qué te gustaría hacer?`;
  
  await ctx.reply(mensaje, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🛒 Hacer pedido', callback_data: 'hacer_pedido' }],
        [{ text: '📋 Ver mis pedidos', callback_data: 'ver_pedidos' }],
        [{ text: '❓ Ayuda', callback_data: 'ayuda' }]
      ]
    }
  });
});

bot.command('ayuda', async (ctx) => {
  const mensaje = `📋 *Comandos disponibles:*\n\n` +
    `🛒 /start - Iniciar nuevo pedido\n` +
    `📋 /pedidos - Ver mis pedidos\n` +
    `❓ /ayuda - Mostrar esta ayuda\n\n` +
    `💡 *Cómo hacer un pedido:*\n` +
    `1. Presiona "Hacer pedido"\n` +
    `2. Selecciona tu cliente\n` +
    `3. Elige categorías y productos\n` +
    `4. Agrega al carrito\n` +
    `5. Confirma tu pedido`;
  
  await ctx.reply(mensaje, { parse_mode: 'Markdown' });
});

// Manejo de callbacks
bot.on('callback_query', async (ctx) => {
  const userId = ctx.from.id;
  const userName = ctx.from.first_name || 'Usuario';
  const callbackData = ctx.callbackQuery.data;
  
  console.log(`🔘 Callback de ${userName}: ${callbackData}`);
  
  try {
    await ctx.answerCbQuery();
    
    if (callbackData === 'hacer_pedido') {
      console.log(`🛒 ${userName} inicia pedido`);
      
      const clientes = await obtenerDatosMySQL('Clientes');
      
      if (clientes.length === 0) {
        await ctx.reply('❌ No hay clientes disponibles');
        return;
      }
      
      console.log(`👥 ${clientes.length} clientes disponibles`);
      setUserState(userId, { step: 'seleccionar_cliente' });
      
      // Agrupar clientes por localidad
      const clientesAgrupados = agruparClientesPorLocalidad(clientes);
      const localidades = Object.keys(clientesAgrupados);
      
      // Crear keyboard con búsqueda primero, luego localidades
      const keyboard = [];
      
      // Botón de búsqueda al inicio
      keyboard.push([{ text: '🔍 Buscar cliente', callback_data: 'buscar_cliente' }]);
      
      // Separador visual
      keyboard.push([{ text: '📍 ── LOCALIDADES ──', callback_data: 'separator' }]);
      
      // Agregar cada localidad
      localidades.forEach(localidad => {
        const cantidadClientes = clientesAgrupados[localidad].length;
        keyboard.push([{
          text: `📍 ${localidad} (${cantidadClientes})`,
          callback_data: `localidad_${localidad}`
        }]);
      });
      
      await ctx.reply('👤 Selecciona el cliente:', {
        reply_markup: { inline_keyboard: keyboard }
      });
      
    } else if (callbackData === 'seguir_comprando') {
      const userState = getUserState(userId);
      const cliente = userState.cliente;
      const cart = getUserCart(userId);
      
      if (!cliente) {
        return bot.handleUpdate({
          callback_query: { ...ctx.callbackQuery, data: 'hacer_pedido' }
        });
      }
      
      console.log(`🛒 ${userName} sigue comprando para ${cliente.nombre}`);
      
      const categorias = await obtenerDatosMySQL('Categorias');
      
      const keyboard = categorias.map(cat => [{
        text: `📂 ${cat.categoria_nombre}`,
        callback_data: `categoria_${cat.categoria_id}`
      }]);
      
      keyboard.push([{ text: '🔍 Buscar producto', callback_data: 'buscar_producto_general' }]);
      keyboard.push([{ text: '🛒 Ver carrito', callback_data: 'ver_carrito' }]);
      
      const cartInfo = cart.length > 0 ? ` (${cart.length} productos)` : '';
      
      await ctx.editMessageText(`✅ Cliente: ${cliente.nombre}${cartInfo}\n\n📂 Selecciona una categoría:`, {
        reply_markup: { inline_keyboard: keyboard }
      });
      
    } else if (callbackData === 'buscar_cliente') {
      console.log(`🔍 ${userName} inicia búsqueda de cliente`);
      setUserState(userId, { step: 'buscar_cliente' });
      await ctx.editMessageText('🔍 Escribe el nombre del cliente que buscas:');
      
    } else if (callbackData.startsWith('cliente_')) {
      const clienteId = parseInt(callbackData.split('_')[1]);
      console.log(`👤 Cliente: ${clienteId}`);
      
      const clientes = await obtenerDatosMySQL('Clientes');
      const cliente = clientes.find(c => c.cliente_id == clienteId);
      
      if (!cliente) {
        await ctx.reply('❌ Cliente no encontrado');
        return;
      }
      
      setUserState(userId, { 
        step: 'seleccionar_categoria', 
        cliente: cliente,
        pedido_id: await generarPedidoId()
      });
      
      const categorias = await obtenerDatosMySQL('Categorias');
      
      const keyboard = categorias.map(cat => [{
        text: `📂 ${cat.categoria_nombre}`,
        callback_data: `categoria_${cat.categoria_id}`
      }]);
      
      keyboard.push([{ text: '🔍 Buscar producto', callback_data: 'buscar_producto_general' }]);
      keyboard.push([{ text: '🛒 Ver carrito', callback_data: 'ver_carrito' }]);
      
      await ctx.editMessageText(`✅ Cliente: ${cliente.nombre}\n\n📂 Selecciona una categoría:`, {
        reply_markup: { inline_keyboard: keyboard }
      });
      
    } else if (callbackData.startsWith('localidad_')) {
      const localidad = decodeURIComponent(callbackData.split('_')[1]);
      console.log(`📍 Localidad seleccionada: ${localidad}`);
      
      const clientes = await obtenerDatosMySQL('Clientes');
      const clientesLocalidad = clientes.filter(cliente => 
        (cliente.localidad || 'Sin localidad') === localidad
      );
      
      if (clientesLocalidad.length === 0) {
        await ctx.reply('❌ No hay clientes en esta localidad');
        return;
      }
      
      const keyboard = clientesLocalidad.map(cliente => ({
        text: `👤 ${cliente.nombre}`,
        callback_data: `cliente_${cliente.cliente_id}`
      })).map(btn => [btn]);
      
      // Botón para volver a localidades
      keyboard.push([{ text: '🔙 Volver a localidades', callback_data: 'hacer_pedido' }]);
      
      await ctx.editMessageText(`📍 ${localidad} - Selecciona el cliente:`, {
        reply_markup: { inline_keyboard: keyboard }
      });
      
    } else if (callbackData === 'separator') {
      // No hacer nada, es solo visual
      return;
      
    } else if (callbackData.startsWith('categoria_')) {
      const categoriaId = parseInt(callbackData.split('_')[1]);
      console.log(`📂 Categoría: ${categoriaId}`);
      
      const connection = await pool.getConnection();
      let productos = [];
      try {
        const [result] = await connection.execute(
          'SELECT producto_id, categoria_id, producto_nombre, precio1, precio2, precio3, precio4, precio5 FROM Productos WHERE categoria_id = ? AND activo = "SI" ORDER BY producto_nombre',
          [categoriaId]
        );
        productos = result;
      } catch (error) {
        console.error('❌ Error obteniendo productos:', error.code || error.message);
        await ctx.reply('❌ Error obteniendo productos. Intenta nuevamente.');
        return;
      } finally {
        connection.release();
      }
      
      if (productos.length === 0) {
        await ctx.reply('❌ No hay productos disponibles en esta categoría');
        return;
      }
      
      const connection2 = await pool.getConnection();
      let categorias = [];
      try {
        const [result] = await connection2.execute(
          'SELECT categoria_nombre FROM Categorias WHERE categoria_id = ?',
          [categoriaId]
        );
        categorias = result;
      } catch (error) {
        console.error('❌ Error obteniendo categoría:', error.code || error.message);
      } finally {
        connection2.release();
      }
      
      const nombreCategoria = categorias.length > 0 ? categorias[0].categoria_nombre : 'Categoría';
      
      const keyboard = productos.map(producto => [{
        text: `🛍️ ${producto.producto_nombre}`,
        callback_data: `producto_${producto.producto_id}`
      }]);
      
      keyboard.push([{ text: '🔍 Buscar producto', callback_data: `buscar_producto_${categoriaId}` }]);
      keyboard.push([{ text: '📂 Ver categorías', callback_data: 'seguir_comprando' }]);
      keyboard.push([{ text: '🛒 Ver carrito', callback_data: 'ver_carrito' }]);
      
      await ctx.editMessageText(`📂 Categoría: ${nombreCategoria}\n\n🛍️ Selecciona un producto:`, {
        reply_markup: { inline_keyboard: keyboard }
      });
      
    } else if (callbackData.startsWith('producto_')) {
      const productoId = parseInt(callbackData.split('_')[1]);
      console.log(`🛍️ Producto: ${productoId}`);
      
      const connection = await pool.getConnection();
      let productos = [];
      try {
        const [result] = await connection.execute(
          'SELECT producto_id, categoria_id, producto_nombre, precio1, precio2, precio3, precio4, precio5 FROM Productos WHERE producto_id = ?',
          [productoId]
        );
        productos = result;
      } catch (error) {
        console.error('❌ Error obteniendo producto:', error.code || error.message);
        await ctx.reply('❌ Error obteniendo producto. Intenta nuevamente.');
        return;
      } finally {
        connection.release();
      }
      
      if (productos.length === 0) {
        await ctx.reply('❌ Producto no encontrado');
        return;
      }
      
      const producto = productos[0];
      const userState = getUserState(userId);
      const cliente = userState.cliente;
      const precio = calcularPrecio(producto, cliente.lista || 1);
      
      const keyboard = [
        [
          { text: '1️⃣ x1', callback_data: `cantidad_${productoId}_1` },
          { text: '2️⃣ x2', callback_data: `cantidad_${productoId}_2` },
          { text: '3️⃣ x3', callback_data: `cantidad_${productoId}_3` }
        ],
        [
          { text: '4️⃣ x4', callback_data: `cantidad_${productoId}_4` },
          { text: '5️⃣ x5', callback_data: `cantidad_${productoId}_5` },
          { text: '🔢 Otra cantidad', callback_data: `cantidad_custom_${productoId}` }
        ],
        [{ text: '🔙 Volver', callback_data: `categoria_${producto.categoria_id}` }]
      ];
      
      await ctx.editMessageText(
        `🛍️ ${producto.producto_nombre}\n💰 Precio: $${precio.toLocaleString()}\n\n¿Cuántas unidades?`,
        { reply_markup: { inline_keyboard: keyboard } }
      );
      
    } else if (callbackData.startsWith('cantidad_')) {
      const parts = callbackData.split('_');
      
      if (parts[1] === 'custom') {
        const productoId = parseInt(parts[2]);
        setUserState(userId, { 
          ...getUserState(userId), 
          step: 'cantidad_custom', 
          producto_id: productoId 
        });
        
        await ctx.editMessageText('🔢 Escribe la cantidad que deseas:');
        return;
      }
      
      const productoId = parseInt(parts[1]);
      const cantidad = parseInt(parts[2]);
      
      console.log(`📦 Carrito: +${cantidad} producto ${productoId}`);
      
      const connection = await pool.getConnection();
      let productos = [];
      try {
        const [result] = await connection.execute(
          'SELECT producto_id, categoria_id, producto_nombre, precio1, precio2, precio3, precio4, precio5 FROM Productos WHERE producto_id = ?',
          [productoId]
        );
        productos = result;
      } catch (error) {
        console.error('❌ Error obteniendo producto para carrito:', error.code || error.message);
        await ctx.reply('❌ Error agregando al carrito. Intenta nuevamente.');
        return;
      } finally {
        connection.release();
      }
      
      if (productos.length === 0) {
        await ctx.reply('❌ Producto no encontrado');
        return;
      }
      
      const producto = productos[0];
      const userState = getUserState(userId);
      const cliente = userState.cliente;
      const precio = calcularPrecio(producto, cliente.lista || 1);
      const importe = precio * cantidad;
      
      const cart = getUserCart(userId);
      cart.push({
        producto_id: productoId,
        producto_nombre: producto.producto_nombre,
        categoria_id: producto.categoria_id,
        cantidad: cantidad,
        precio_unitario: precio,
        importe: importe
      });
      setUserCart(userId, cart);
      
      await ctx.reply(
        `✅ Agregado al carrito:\n🛍️ ${producto.producto_nombre}\n📦 Cantidad: ${cantidad}\n💰 Subtotal: $${importe.toLocaleString()}\n\n¿Qué más necesitas?`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '➕ Seguir comprando', callback_data: 'seguir_comprando' }],
              [{ text: '🛒 Ver carrito', callback_data: 'ver_carrito' }],
              [{ text: '✅ Finalizar pedido', callback_data: 'finalizar_pedido' }]
            ]
          }
        }
      );
      
    } else if (callbackData === 'ver_carrito') {
      const cart = getUserCart(userId);
      
      if (cart.length === 0) {
        await ctx.reply('🛒 Tu carrito está vacío', {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🛍️ Empezar a comprar', callback_data: 'seguir_comprando' }]
            ]
          }
        });
        return;
      }
      
      let mensaje = '🛒 *Tu carrito:*\n\n';
      let total = 0;
      
      cart.forEach((item, index) => {
        mensaje += `${index + 1}. *${item.producto_nombre}*\n`;
        mensaje += `   📦 Cantidad: ${item.cantidad}\n`;
        mensaje += `   💰 $${item.precio_unitario.toLocaleString()} c/u = $${item.importe.toLocaleString()}\n\n`;
        total += item.importe;
      });
      
      mensaje += `💰 *Total: $${total.toLocaleString()}*`;
      
      // Crear botones para eliminar productos individuales
      const keyboard = [];
      
      // Agregar botón de eliminar para cada producto (máximo 10)
      if (cart.length <= 10) {
        cart.forEach((item, index) => {
          keyboard.push([{
            text: `🗑️ Eliminar: ${item.producto_nombre.substring(0, 25)}${item.producto_nombre.length > 25 ? '...' : ''}`,
            callback_data: `eliminar_item_${index}`
          }]);
        });
        
        // Separador visual
        keyboard.push([{ text: '── ACCIONES ──', callback_data: 'separator' }]);
      }
      
      // Botones principales
      keyboard.push([{ text: '➕ Seguir comprando', callback_data: 'seguir_comprando' }]);
      keyboard.push([{ text: '✅ Finalizar pedido', callback_data: 'finalizar_pedido' }]);
      keyboard.push([{ text: '🗑️ Vaciar carrito', callback_data: 'vaciar_carrito' }]);
      
      await ctx.reply(mensaje, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });
      
    } else if (callbackData.startsWith('eliminar_item_')) {
      const itemIndex = parseInt(callbackData.split('_')[2]);
      const cart = getUserCart(userId);
      
      if (itemIndex < 0 || itemIndex >= cart.length) {
        await ctx.reply('❌ Producto no encontrado en el carrito');
        return;
      }
      
      const itemEliminado = cart[itemIndex];
      console.log(`🗑️ ${userName} elimina: ${itemEliminado.producto_nombre}`);
      
      // Eliminar el producto del carrito
      cart.splice(itemIndex, 1);
      setUserCart(userId, cart);
      
      if (cart.length === 0) {
        await ctx.editMessageText('🗑️ Producto eliminado. Tu carrito está vacío.', {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🛍️ Empezar a comprar', callback_data: 'seguir_comprando' }]
            ]
          }
        });
        return;
      }
      
      // Mostrar carrito actualizado
      let mensaje = '✅ Producto eliminado\n\n🛒 *Tu carrito actualizado:*\n\n';
      let total = 0;
      
      cart.forEach((item, index) => {
        mensaje += `${index + 1}. *${item.producto_nombre}*\n`;
        mensaje += `   📦 Cantidad: ${item.cantidad}\n`;
        mensaje += `   💰 $${item.precio_unitario.toLocaleString()} c/u = $${item.importe.toLocaleString()}\n\n`;
        total += item.importe;
      });
      
      mensaje += `💰 *Total: $${total.toLocaleString()}*`;
      
      // Crear botones actualizados
      const keyboard = [];
      
      if (cart.length <= 10) {
        cart.forEach((item, index) => {
          keyboard.push([{
            text: `🗑️ Eliminar: ${item.producto_nombre.substring(0, 25)}${item.producto_nombre.length > 25 ? '...' : ''}`,
            callback_data: `eliminar_item_${index}`
          }]);
        });
        
        keyboard.push([{ text: '── ACCIONES ──', callback_data: 'separator' }]);
      }
      
      keyboard.push([{ text: '➕ Seguir comprando', callback_data: 'seguir_comprando' }]);
      keyboard.push([{ text: '✅ Finalizar pedido', callback_data: 'finalizar_pedido' }]);
      keyboard.push([{ text: '🗑️ Vaciar carrito', callback_data: 'vaciar_carrito' }]);
      
      await ctx.editMessageText(mensaje, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });
      
    } else if (callbackData === 'finalizar_pedido') {
      const cart = getUserCart(userId);
      
      if (cart.length === 0) {
        await ctx.reply('❌ Tu carrito está vacío');
        return;
      }
      
      // Preguntar por observaciones antes de finalizar
      setUserState(userId, { 
        ...getUserState(userId), 
        step: 'pregunta_observacion' 
      });
      
      await ctx.reply('📝 ¿Deseas agregar alguna observación al pedido?', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Sí, agregar observación', callback_data: 'agregar_observacion' }],
            [{ text: '❌ No, finalizar sin observación', callback_data: 'finalizar_sin_observacion' }]
          ]
        }
      });
      
    } else if (callbackData === 'agregar_observacion') {
      setUserState(userId, { 
        ...getUserState(userId), 
        step: 'escribir_observacion' 
      });
      
      await ctx.reply('📝 Escribe tu observación para el pedido:');
      
    } else if (callbackData === 'finalizar_sin_observacion') {
      await confirmarPedido(ctx, userId, '');
      
    } else if (callbackData === 'vaciar_carrito') {
      setUserCart(userId, []);
      await ctx.reply('🗑️ Carrito vaciado', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🛍️ Empezar a comprar', callback_data: 'seguir_comprando' }]
          ]
        }
      });
      
    } else if (callbackData.startsWith('buscar_producto_')) {
      const categoriaId = parseInt(callbackData.split('_')[2]);
      setUserState(userId, { 
        ...getUserState(userId), 
        step: 'buscar_producto',
        categoria_busqueda: categoriaId
      });
      await ctx.reply('🔍 Escribe el nombre del producto que buscas:');
    }
    
  } catch (error) {
    console.error('❌ Error en callback:', error);
    await ctx.reply('❌ Ocurrió un error. Intenta nuevamente.');
  }
});

// Manejo de mensajes de texto
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const userName = ctx.from.first_name || 'Usuario';
  const userState = getUserState(userId);
  const text = ctx.message.text;
  
  console.log(`💬 Mensaje de ${userName}: "${text}" (Estado: ${userState.step})`);
  
  try {
    if (userState.step === 'cantidad_custom') {
      const cantidad = parseInt(text);
      
      if (isNaN(cantidad) || cantidad <= 0) {
        await ctx.reply('❌ Por favor ingresa un número válido mayor a 0');
        return;
      }
      
      const productoId = userState.producto_id;
      const [productos] = await pool.execute(
        'SELECT producto_id, categoria_id, producto_nombre, precio1, precio2, precio3, precio4, precio5 FROM Productos WHERE producto_id = ?',
        [productoId]
      );
      
      if (productos.length === 0) {
        await ctx.reply('❌ Producto no encontrado');
        return;
      }
      
      const producto = productos[0];
      const cliente = userState.cliente;
      const precio = calcularPrecio(producto, cliente.lista || 1);
      const importe = precio * cantidad;
      
      const cart = getUserCart(userId);
      cart.push({
        producto_id: productoId,
        producto_nombre: producto.producto_nombre,
        categoria_id: producto.categoria_id,
        cantidad: cantidad,
        precio_unitario: precio,
        importe: importe
      });
      setUserCart(userId, cart);
      
      setUserState(userId, { ...userState, step: 'seleccionar_categoria' });
      
      await ctx.reply(
        `✅ Agregado al carrito:\n🛍️ ${producto.producto_nombre}\n📦 Cantidad: ${cantidad}\n💰 Subtotal: $${importe.toLocaleString()}\n\n¿Qué más necesitas?`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '➕ Seguir comprando', callback_data: 'seguir_comprando' }],
              [{ text: '🛒 Ver carrito', callback_data: 'ver_carrito' }],
              [{ text: '✅ Finalizar pedido', callback_data: 'finalizar_pedido' }]
            ]
          }
        }
      );
      
    } else if (userState.step === 'buscar_cliente') {
      const termino = text.toLowerCase().trim();
      
      if (termino.length < 2) {
        await ctx.reply('❌ Escribe al menos 2 caracteres para buscar');
        return;
      }
      
      const connection = await pool.getConnection();
      let clientes = [];
      try {
        const [result] = await connection.execute(
          'SELECT cliente_id, nombre, lista, localidad FROM Clientes WHERE LOWER(nombre) LIKE ? ORDER BY nombre',
          [`%${termino}%`]
        );
        clientes = result;
      } catch (error) {
        console.error('❌ Error buscando clientes:', error.code || error.message);
        await ctx.reply('❌ Error en la búsqueda. Intenta nuevamente.');
        return;
      } finally {
        connection.release();
      }
      
      if (clientes.length === 0) {
        await ctx.reply(`❌ No se encontraron clientes con "${text}"`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔍 Buscar de nuevo', callback_data: 'buscar_cliente' }],
              [{ text: '👥 Ver todos los clientes', callback_data: 'hacer_pedido' }]
            ]
          }
        });
        return;
      }
      
      const keyboard = clientes.map(cliente => [{
        text: `👤 ${cliente.nombre}`,
        callback_data: `cliente_${cliente.cliente_id}`
      }]);
      
      keyboard.push([{ text: '🔍 Buscar de nuevo', callback_data: 'buscar_cliente' }]);
      keyboard.push([{ text: '👥 Ver todos', callback_data: 'hacer_pedido' }]);
      
      await ctx.reply(`🔍 Encontrados ${clientes.length} cliente(s):`, {
        reply_markup: { inline_keyboard: keyboard }
      });
      
    } else if (userState.step === 'buscar_producto') {
      const termino = text.toLowerCase().trim();
      
      if (termino.length < 2) {
        await ctx.reply('❌ Escribe al menos 2 caracteres para buscar');
        return;
      }
      
      const categoriaId = userState.categoria_busqueda;
      
      let query = 'SELECT producto_id, categoria_id, producto_nombre, precio1, precio2, precio3, precio4, precio5 FROM Productos WHERE LOWER(producto_nombre) LIKE ? AND activo = "SI"';
      let params = [`%${termino}%`];
      
      if (categoriaId) {
        query += ' AND categoria_id = ?';
        params.push(categoriaId);
      }
      
      query += ' ORDER BY producto_nombre';
      
      const connection = await pool.getConnection();
      let productos = [];
      try {
        const [result] = await connection.execute(query, params);
        productos = result;
      } catch (error) {
        console.error('❌ Error buscando productos:', error.code || error.message);
        await ctx.reply('❌ Error en la búsqueda. Intenta nuevamente.');
        return;
      } finally {
        connection.release();
      }
      
      if (productos.length === 0) {
        await ctx.reply(`❌ No se encontraron productos con "${text}"`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔍 Buscar de nuevo', callback_data: `buscar_producto_${categoriaId || 'general'}` }],
              [{ text: '📂 Ver categoría', callback_data: `categoria_${categoriaId}` }]
            ]
          }
        });
        return;
      }
      
      const keyboard = productos.map(producto => [{
        text: `🛍️ ${producto.producto_nombre}`,
        callback_data: `producto_${producto.producto_id}`
      }]);
      
      const botonesBusquedaExitosa = categoriaId ? [
        [{ text: '🔍 Buscar de nuevo', callback_data: `buscar_producto_${categoriaId}` }],
        [{ text: '📂 Ver categoría', callback_data: `categoria_${categoriaId}` }]
      ] : [
        [{ text: '🔍 Buscar de nuevo', callback_data: 'buscar_producto_general' }],
        [{ text: '📂 Ver categorías', callback_data: 'seguir_comprando' }]
      ];
      
      keyboard.push(...botonesBusquedaExitosa);
      
      await ctx.reply(`🔍 Encontrados ${productos.length} producto(s):`, {
        reply_markup: { inline_keyboard: keyboard }
      });
      
    } else if (userState.step === 'escribir_observacion') {
      const observacion = text.trim();
      
      if (observacion.length === 0) {
        await ctx.reply('❌ Por favor escribe una observación válida o usa /start para cancelar');
        return;
      }
      
      if (observacion.length > 500) {
        await ctx.reply('❌ La observación es muy larga. Máximo 500 caracteres.');
        return;
      }
      
      console.log(`📝 Observación de ${userName}: "${observacion}"`);
      
      // Confirmar pedido con observación
      await confirmarPedido(ctx, userId, observacion);
      
    } else {
      // Mensaje no reconocido
      await ctx.reply(
        '❓ No entiendo ese mensaje. Usa /start para comenzar o los botones del menú.',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🏠 Menú principal', callback_data: 'start' }]
            ]
          }
        }
      );
    }
    
  } catch (error) {
    console.error('❌ Error procesando mensaje:', error);
    await ctx.reply('❌ Ocurrió un error. Intenta nuevamente.');
  }
});

// Función para confirmar pedido
async function confirmarPedido(ctx, userId, observacion = '') {
  try {
    const userState = getUserState(userId);
    const cart = getUserCart(userId);
    const cliente = userState.cliente;
    const pedidoId = userState.pedido_id;
    
    if (!cliente || cart.length === 0) {
      await ctx.reply('❌ Error: No hay cliente o carrito vacío');
      return;
    }
    
    console.log(`✅ Confirmando pedido ${pedidoId} para ${cliente.nombre}${observacion ? ' con observación' : ''}`);
    
    // Calcular totales
    const itemsTotal = cart.reduce((sum, item) => sum + item.cantidad, 0);
    const montoTotal = cart.reduce((sum, item) => sum + item.importe, 0);
    
    // Crear pedido en MySQL
    const fechaHora = new Date().toISOString().slice(0, 19).replace('T', ' ');
    
    const pedidoData = [
      pedidoId,
      fechaHora,
      cliente.cliente_id,
      cliente.nombre,
      itemsTotal,
      montoTotal,
      'PENDIENTE',
      observacion
    ];
    
    await agregarDatosMySQL('Pedidos', pedidoData);
    
    // Crear detalles del pedido
    for (let i = 0; i < cart.length; i++) {
      const item = cart[i];
      const detalleId = `${pedidoId}_${i + 1}`;
      
      const detalleData = [
        detalleId,
        pedidoId,
        item.producto_id,
        item.producto_nombre,
        item.categoria_id,
        item.cantidad,
        item.precio_unitario,
        item.importe,
        ''
      ];
      
      await agregarDatosMySQL('DetallePedidos', detalleData);
    }
    
    // Limpiar estado del usuario
    setUserState(userId, { step: 'idle' });
    setUserCart(userId, []);
    
    // Mensaje de confirmación
    let mensaje = `✅ *Pedido registrado*\n\n`;
    mensaje += `📋 ID: ${pedidoId}\n`;
    mensaje += `👤 Cliente: ${cliente.nombre}\n`;
    mensaje += `📅 Fecha: ${fechaHora}\n`;
    mensaje += `📦 Items: ${itemsTotal}\n`;
    mensaje += `💰 Total: $${montoTotal.toLocaleString()}\n\n`;
    
    if (observacion) {
      mensaje += `📝 Observación: ${observacion}\n\n`;
    }
    
    mensaje += `⏳ Estado: PENDIENTE\n\n`;
    mensaje += `🎉 ¡Pedido registrado exitosamente!`;
    
    await ctx.reply(mensaje, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🛒 Nuevo pedido', callback_data: 'hacer_pedido' }],
          [{ text: '🏠 Menú principal', callback_data: 'start' }]
        ]
      }
    });
    
    console.log(`✅ Pedido ${pedidoId} guardado exitosamente en MySQL`);
    
  } catch (error) {
    console.error('❌ Error confirmando pedido:', error);
    await ctx.reply('❌ Error al confirmar el pedido. Intenta nuevamente.');
  }
}

// Configurar webhook
app.post('/webhook', (req, res) => {
  try {
    console.log('📨 Webhook recibido:', JSON.stringify(req.body, null, 2));
    bot.handleUpdate(req.body);
    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Error en webhook:', error);
    res.status(500).send('Error');
  }
});

// API Routes
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    port: PORT,
    database: 'MySQL'
  });
});

app.get('/api/info', (req, res) => {
  res.json({
    name: 'Sistema Distribuidora Bot',
    version: '2.0.0',
    status: 'running',
    database: 'MySQL',
    features: [
      'Bot de Telegram',
      'Integración MySQL',
      'Sistema de pedidos',
      'Carrito de compras'
    ]
  });
});

app.get('/api/clientes', async (req, res) => {
  try {
    const clientes = await obtenerDatosMySQL('Clientes');
    res.json({ success: true, clientes });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/productos', async (req, res) => {
  try {
    const productos = await obtenerDatosMySQL('Productos');
    res.json({ success: true, productos });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/detalles-pedidos', async (req, res) => {
  try {
    const detalles = await obtenerDatosMySQL('DetallePedidos');
    res.json({ success: true, detalles });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/pedidos-completos', async (req, res) => {
  // Verificar conexión primero
  const conexionDisponible = await verificarConexionMySQL();
  if (!conexionDisponible) {
    return res.status(503).json({ 
      success: false, 
      error: 'Base de datos no disponible. Verifica la configuración de MySQL.',
      database: 'MySQL (no disponible)',
      fallback: true
    });
  }

  try {
    console.log('📊 Obteniendo pedidos completos desde MySQL...');
    
    const connection = await pool.getConnection();
    let pedidosCompletos = [];
    
    try {
      // Obtener pedidos con sus detalles usando JOIN
      const [result] = await connection.execute(`
        SELECT 
          p.pedido_id,
          p.fecha_hora,
          p.cliente_id,
          p.cliente_nombre,
          p.items_cantidad,
          p.total,
          p.estado,
          p.observacion,
          COUNT(d.detalle_id) as cantidad_items_real,
          SUM(d.importe) as total_calculado
        FROM Pedidos p
        LEFT JOIN DetallePedidos d ON p.pedido_id = d.pedido_id
        GROUP BY p.pedido_id
        ORDER BY p.fecha_hora DESC
      `);
      pedidosCompletos = result;
      
      // Obtener detalles para cada pedido
      for (const pedido of pedidosCompletos) {
        const [detalles] = await connection.execute(
          'SELECT detalle_id, producto_id, producto_nombre, categoria_id, cantidad, precio_unitario, importe, observaciones FROM DetallePedidos WHERE pedido_id = ? ORDER BY detalle_id',
          [pedido.pedido_id]
        );
        pedido.detalles = detalles;
      }
      
    } finally {
      connection.release();
    }
    
    console.log(`✅ ${pedidosCompletos.length} pedidos completos procesados desde MySQL`);
    
    res.json({ 
      success: true, 
      pedidos: pedidosCompletos,
      total_pedidos: pedidosCompletos.length,
      database: 'MySQL'
    });
    
  } catch (error) {
    console.error('❌ Error obteniendo pedidos completos:', error.code || error.message);
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      console.error('🔌 Problema de conexión con MySQL. Verifica la configuración de red.');
      res.status(503).json({ 
        success: false, 
        error: 'Error de conexión con la base de datos. Verifica la configuración.',
        code: error.code,
        database: 'MySQL (error de conexión)'
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: error.message,
        database: 'MySQL (error interno)'
      });
    }
  }
});

// Endpoint para actualizar estado del pedido
app.put('/api/pedidos/:pedidoId/estado', async (req, res) => {
  try {
    const { pedidoId } = req.params;
    const { estado } = req.body;
    
    console.log(`🔄 Actualizando pedido ${pedidoId} a estado: ${estado}`);
    
    if (!pedidoId || !estado) {
      return res.status(400).json({ 
        success: false, 
        error: 'pedidoId y estado son requeridos' 
      });
    }
    
    // Validar estados permitidos
    const estadosPermitidos = ['PENDIENTE', 'CONFIRMADO', 'CANCELADO'];
    if (!estadosPermitidos.includes(estado.toUpperCase())) {
      return res.status(400).json({ 
        success: false, 
        error: 'Estado no válido. Debe ser: PENDIENTE, CONFIRMADO o CANCELADO' 
      });
    }
    
    const connection = await pool.getConnection();
    try {
      // Verificar que el pedido existe
      const [pedidos] = await connection.execute(
        'SELECT pedido_id FROM Pedidos WHERE pedido_id = ?',
        [pedidoId]
      );
      
      if (pedidos.length === 0) {
        return res.status(404).json({ 
          success: false, 
          error: `Pedido ${pedidoId} no encontrado` 
        });
      }
      
      // Actualizar el estado en MySQL
      await connection.execute(
        'UPDATE Pedidos SET estado = ? WHERE pedido_id = ?',
        [estado.toUpperCase(), pedidoId]
      );
      
    } finally {
      connection.release();
    }
    
    console.log(`✅ Pedido ${pedidoId} actualizado a ${estado} en MySQL`);
    
    res.json({ 
      success: true, 
      message: `Estado actualizado exitosamente`,
      pedido_id: pedidoId,
      nuevo_estado: estado.toUpperCase(),
      database: 'MySQL'
    });
    
  } catch (error) {
    console.error('❌ Error actualizando estado:', error.code || error.message);
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
      res.status(503).json({ 
        success: false, 
        error: 'Error de conexión con la base de datos. Verifica la configuración.',
        code: error.code
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }
});

// Test de conexión MySQL
app.get('/api/test/mysql', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.execute('SELECT DATABASE() as db_name, NOW() as current_time');
    connection.release();
    
    res.json({
      success: true,
      database: rows[0].db_name,
      current_time: rows[0].current_time,
      message: 'Conexión MySQL exitosa'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Iniciar servidor
app.listen(PORT, async () => {
  console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
  console.log(`🌐 Dashboard: http://localhost:${PORT}`);
  console.log(`🤖 Bot de Telegram configurado`);
  
  // Verificar conexión MySQL
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.execute('SELECT DATABASE() as db_name');
    console.log(`📊 MySQL conectado: ${rows[0].db_name}`);
    connection.release();
  } catch (error) {
    console.error(`❌ Error conectando a MySQL: ${error.message}`);
  }
});

// Manejo de errores
process.on('uncaughtException', (error) => {
  console.error('❌ Error no capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promesa rechazada no manejada:', reason);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🔄 Cerrando servidor...');
  await pool.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🔄 Cerrando servidor...');
  await pool.end();
  process.exit(0);
});