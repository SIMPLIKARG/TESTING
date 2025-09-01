import express from 'express';
import cors from 'cors';
import { Telegraf } from 'telegraf';
import { GoogleAuth } from 'google-auth-library';
import { google } from 'googleapis';
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

// Configuración de Google Sheets
const auth = new GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;

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

// Función para obtener datos de Google Sheets
async function obtenerDatosSheet(nombreHoja) {
  try {
    if (!SPREADSHEET_ID) {
      console.log(`⚠️ Google Sheets no configurado`);
      return [];
    }

    console.log(`📊 [obtenerDatosSheet] Iniciando obtención de ${nombreHoja}...`);
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${nombreHoja}!A:Z`,
    });

    const rows = response.data.values || [];
    console.log(`📋 [obtenerDatosSheet] ${nombreHoja}: ${rows.length} filas obtenidas`);
    
    if (rows.length === 0) return [];

    const headers = rows[0];
    console.log(`📋 [obtenerDatosSheet] Encabezados de ${nombreHoja}:`, headers);
    
    const data = rows.slice(1)
      .filter(row => row && row.length > 0 && row[0] && row[0].toString().trim())
      .map(row => {
        const obj = {};
        headers.forEach((header, index) => {
          obj[header] = row[index] ? row[index].toString().trim() : '';
        });
        return obj;
      })
      .filter(obj => {
        if (nombreHoja === 'Clientes') {
          return obj.cliente_id && obj.nombre && obj.nombre !== '';
        }
        if (nombreHoja === 'Categorias') {
          return obj.categoria_id && obj.categoria_nombre && obj.categoria_nombre !== '';
        }
        if (nombreHoja === 'Productos') {
          return obj.producto_id && obj.producto_nombre && obj.producto_nombre !== '';
        }
        return Object.values(obj).some(val => val && val !== '');
      });

    console.log(`✅ [obtenerDatosSheet] ${nombreHoja}: ${data.length} registros válidos procesados`);
    return data;
  } catch (error) {
    console.error(`❌ Error ${nombreHoja}:`, error.message);
    return [];
  }
}

// Función para agregar datos a Google Sheets
async function agregarDatosSheet(nombreHoja, datos) {
  try {
    if (!SPREADSHEET_ID) {
      console.log(`⚠️ Google Sheets no configurado, simulando inserción en ${nombreHoja}`);
      return true;
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${nombreHoja}!A:Z`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [datos]
      }
    });

    return true;
  } catch (error) {
    console.error(`❌ Error agregando datos a ${nombreHoja}:`, error.message);
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
    if (!SPREADSHEET_ID) {
      return `PD${String(Date.now()).slice(-6).padStart(6, '0')}`;
    }

    const pedidos = await obtenerDatosSheet('Pedidos');
    
    let ultimoNumero = 0;
    pedidos.forEach(pedido => {
      if (pedido.pedido_id && pedido.pedido_id.startsWith('PD')) {
        const numero = parseInt(pedido.pedido_id.replace('PD', ''));
        if (numero > ultimoNumero) {
          ultimoNumero = numero;
        }
      }
    });
    
    const nuevoNumero = ultimoNumero + 1;
    return `PD${String(nuevoNumero).padStart(6, '0')}`;
    
  } catch (error) {
    console.error('❌ Error generando ID:', error);
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

// Función para buscar productos
function buscarProductos(productos, termino, categoriaId = null) {
  console.log(`🔍 [buscarProductos] Buscando "${termino}" en ${productos.length} productos`);
  
  if (!Array.isArray(productos)) {
    console.log(`⚠️ [buscarProductos] productos no es array:`, typeof productos);
    return [];
  }
  
  const terminoLower = termino.toLowerCase().trim();
  
  const resultados = productos.filter(producto => {
    const nombre = (producto.producto_nombre || '').toLowerCase();
    const enCategoria = !categoriaId || producto.categoria_id == categoriaId;
    const activo = producto.activo === 'SI';
    const coincideNombre = nombre.includes(terminoLower);
    const coincideId = producto.producto_id && producto.producto_id.toString().includes(termino);
    
    return (coincideNombre || coincideId) && enCategoria && activo;
  });
  
  console.log(`✅ [buscarProductos] ${resultados.length} productos encontrados`);
  return resultados;
}

// Función para mostrar productos con paginación
async function mostrarProductosPaginados(ctx, productos, pagina = 1, categoriaId = null, termino = null) {
  console.log(`📄 [mostrarProductosPaginados] Página ${pagina}, categoría ${categoriaId}, término "${termino}"`);
  console.log(`📄 [mostrarProductosPaginados] Tipo de productos:`, typeof productos);
  
  if (!Array.isArray(productos)) {
    console.log(`⚠️ [mostrarProductosPaginados] productos no es array:`, typeof productos);
    productos = [];
  }
  
  const productosPorPagina = 8;
  const inicio = (pagina - 1) * productosPorPagina;
  const fin = inicio + productosPorPagina;
  const productosEnPagina = productos.slice(inicio, fin);
  const totalPaginas = Math.ceil(productos.length / productosPorPagina);
  
  console.log(`📄 [mostrarProductosPaginados] Mostrando ${productosEnPagina.length} productos (${inicio}-${fin} de ${productos.length})`);
  
  if (productosEnPagina.length === 0) {
    const mensaje = termino ? 
      `❌ No se encontraron productos con "${termino}"` : 
      '❌ No hay productos disponibles en esta categoría';
    
    const keyboard = [];
    if (categoriaId) {
      keyboard.push([{ text: '🔙 Volver a categorías', callback_data: 'seguir_comprando' }]);
    }
    
    if (ctx.callbackQuery) {
      await ctx.editMessageText(mensaje, {
        reply_markup: { inline_keyboard: keyboard }
      });
    } else {
      await ctx.reply(mensaje, {
        reply_markup: { inline_keyboard: keyboard }
      });
    }
    return;
  }
  
  const keyboard = [];
  
  productosEnPagina.forEach(producto => {
    const nombreCorto = producto.producto_nombre.length > 35 ? 
      producto.producto_nombre.substring(0, 32) + '...' : 
      producto.producto_nombre;
    
    keyboard.push([{
      text: `🛍️ ${nombreCorto}`,
      callback_data: `prod|${producto.producto_id}|${pagina}|${categoriaId || 0}`
    }]);
  });
  
  const navButtons = [];
  
  if (totalPaginas > 1) {
    if (pagina > 1) {
      navButtons.push({
        text: '⬅️ Anterior',
        callback_data: `cat|${categoriaId || 0}|${pagina - 1}`
      });
    }
    
    navButtons.push({
      text: `📄 ${pagina}/${totalPaginas}`,
      callback_data: 'noop'
    });
    
    if (pagina < totalPaginas) {
      navButtons.push({
        text: 'Siguiente ➡️',
        callback_data: `cat|${categoriaId || 0}|${pagina + 1}`
      });
    }
    
    keyboard.push(navButtons);
  }
  
  keyboard.push([
    { text: '🔍 Buscar', callback_data: `buscar|${categoriaId || 0}` },
    { text: '🛒 Carrito', callback_data: 'ver_carrito' }
  ]);
  
  keyboard.push([{ text: '🔙 Categorías', callback_data: 'seguir_comprando' }]);
  
  const categorias = await obtenerDatosSheet('Categorias');
  const categoria = categorias.find(c => c.categoria_id == categoriaId);
  const nombreCategoria = categoria ? categoria.categoria_nombre : 'Productos';
  
  let mensaje = `📂 ${nombreCategoria}\n`;
  if (termino) {
    mensaje += `🔍 Búsqueda: "${termino}"\n`;
  }
  mensaje += `📄 Página ${pagina}/${totalPaginas} (${productos.length} productos)\n\n`;
  mensaje += `🛍️ Selecciona un producto:`;
  
  if (ctx.callbackQuery) {
    await ctx.editMessageText(mensaje, {
      reply_markup: { inline_keyboard: keyboard }
    });
  } else {
    await ctx.reply(mensaje, {
      reply_markup: { inline_keyboard: keyboard }
    });
  }
}

// Función para agregar producto al carrito
function agregarProductoAlCarrito(userId, producto, cantidad, precio) {
  const cart = getUserCart(userId);
  
  const existingIndex = cart.findIndex(item => item.producto_id == producto.producto_id);
  
  if (existingIndex !== -1) {
    const nuevaCantidad = cart[existingIndex].cantidad + cantidad;
    
    if (nuevaCantidad > 999) {
      return { success: false, message: 'Cantidad máxima excedida (999 unidades)' };
    }
    
    cart[existingIndex].cantidad = nuevaCantidad;
    cart[existingIndex].importe = cart[existingIndex].precio_unitario * nuevaCantidad;
  } else {
    const importe = precio * cantidad;
    cart.push({
      producto_id: producto.producto_id,
      producto_nombre: producto.producto_nombre,
      categoria_id: producto.categoria_id,
      cantidad: cantidad,
      precio_unitario: precio,
      importe: importe
    });
  }
  
  setUserCart(userId, cart);
  
  const totalItems = cart.reduce((sum, item) => sum + item.cantidad, 0);
  const totalImporte = cart.reduce((sum, item) => sum + item.importe, 0);
  
  return {
    success: true,
    totalItems,
    totalImporte,
    message: existingIndex !== -1 ? 'Cantidad actualizada en el carrito' : 'Producto agregado al carrito'
  };
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
      
      const clientes = await obtenerDatosSheet('Clientes');
      
      if (clientes.length === 0) {
        await ctx.reply('❌ No hay clientes disponibles');
        return;
      }
      
      console.log(`👥 ${clientes.length} clientes disponibles`);
      setUserState(userId, { step: 'seleccionar_cliente' });
      
      const clientesAgrupados = agruparClientesPorLocalidad(clientes);
      const localidades = Object.keys(clientesAgrupados);
      
      const keyboard = [];
      keyboard.push([{ text: '🔍 Buscar cliente', callback_data: 'buscar_cliente' }]);
      keyboard.push([{ text: '📍 ── LOCALIDADES ──', callback_data: 'separator' }]);
      
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
        await ctx.reply('❌ Debes seleccionar un cliente primero', {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🛒 Hacer pedido', callback_data: 'hacer_pedido' }]
            ]
          }
        });
        return;
      }
      
      console.log(`🛒 ${userName} sigue comprando para ${cliente.nombre}`);
      
      const categorias = await obtenerDatosSheet('Categorias');
      
      const keyboard = categorias.map(cat => [{
        text: `📂 ${cat.categoria_nombre || 'Categoría'}`,
        callback_data: `cat|${cat.categoria_id}|1`
      }]);
      
      keyboard.push([{ text: '🔍 Buscar producto', callback_data: 'buscar|0' }]);
      keyboard.push([{ text: '🛒 Ver carrito', callback_data: 'ver_carrito' }]);
      
      const cartInfo = cart.length > 0 ? ` (${cart.length} productos)` : '';
      
      await ctx.editMessageText(`✅ Cliente: ${cliente.nombre}${cartInfo}\n\n📂 Selecciona una categoría:`, {
        reply_markup: { inline_keyboard: keyboard }
      });
      
    } else if (callbackData.startsWith('cliente_')) {
      const clienteId = parseInt(callbackData.split('_')[1]);
      console.log(`👤 Cliente: ${clienteId}`);
      
      const clientes = await obtenerDatosSheet('Clientes');
      const cliente = clientes.find(c => 
        (c.cliente_id == clienteId) || 
        (c.Cliente_id == clienteId) || 
        (c.id == clienteId)
      );
      
      if (!cliente) {
        await ctx.reply('❌ Cliente no encontrado');
        return;
      }
      
      const nombreCliente = cliente.nombre || cliente.Nombre || 'Cliente';
      const clienteNormalizado = {
        ...cliente,
        nombre: nombreCliente
      };
      
      setUserState(userId, { 
        step: 'seleccionar_categoria', 
        cliente: clienteNormalizado,
        pedido_id: await generarPedidoId()
      });
      
      const categorias = await obtenerDatosSheet('Categorias');
      
      const keyboard = categorias.map(cat => [{
        text: `📂 ${cat.categoria_nombre || 'Categoría'}`,
        callback_data: `cat|${cat.categoria_id}|1`
      }]);
      
      keyboard.push([{ text: '🔍 Buscar producto', callback_data: 'buscar|0' }]);
      keyboard.push([{ text: '🛒 Ver carrito', callback_data: 'ver_carrito' }]);
      
      await ctx.editMessageText(`✅ Cliente: ${nombreCliente}\n\n📂 Selecciona una categoría:`, {
        reply_markup: { inline_keyboard: keyboard }
      });
      
    } else if (callbackData.startsWith('cat|')) {
      const [, categoriaId, pagina] = callbackData.split('|').map(Number);
      console.log(`📂 Categoría: ${categoriaId}, Página: ${pagina}`);
      
      const productos = await obtenerDatosSheet('Productos');
      console.log(`📦 [callback cat] Productos obtenidos:`, typeof productos, Array.isArray(productos) ? productos.length : 'no es array');
      
      const productosCategoria = Array.isArray(productos) ? 
        productos.filter(p => p.categoria_id == categoriaId && p.activo === 'SI') : [];
      
      await mostrarProductosPaginados(ctx, productosCategoria, pagina, categoriaId);
      
    } else if (callbackData.startsWith('prod|')) {
      const [, productoId, paginaAnterior, categoriaId] = callbackData.split('|').map(Number);
      console.log(`🛍️ Producto: ${productoId}`);
      
      const productos = await obtenerDatosSheet('Productos');
      const producto = productos.find(p => p.producto_id == productoId);
      
      if (!producto) {
        await ctx.reply('❌ Producto no encontrado');
        return;
      }
      
      const userState = getUserState(userId);
      const cliente = userState.cliente;
      const precio = calcularPrecio(producto, cliente.lista || 1);
      
      const keyboard = [
        [
          { text: '1️⃣ x1', callback_data: `cant|${productoId}|1|${paginaAnterior}|${categoriaId}` },
          { text: '2️⃣ x2', callback_data: `cant|${productoId}|2|${paginaAnterior}|${categoriaId}` },
          { text: '3️⃣ x3', callback_data: `cant|${productoId}|3|${paginaAnterior}|${categoriaId}` }
        ],
        [
          { text: '4️⃣ x4', callback_data: `cant|${productoId}|4|${paginaAnterior}|${categoriaId}` },
          { text: '5️⃣ x5', callback_data: `cant|${productoId}|5|${paginaAnterior}|${categoriaId}` },
          { text: '🔢 Otra', callback_data: `custom|${productoId}|${paginaAnterior}|${categoriaId}` }
        ],
        [{ text: '🔙 Volver', callback_data: `cat|${categoriaId}|${paginaAnterior}` }]
      ];
      
      await ctx.editMessageText(
        `🛍️ ${producto.producto_nombre}\n💰 Precio: $${precio.toLocaleString()}\n\n¿Cuántas unidades?`,
        { reply_markup: { inline_keyboard: keyboard } }
      );
      
    } else if (callbackData.startsWith('cant|')) {
      const [, productoId, cantidad, paginaAnterior, categoriaId] = callbackData.split('|').map(Number);
      
      console.log(`📦 Carrito: +${cantidad} producto ${productoId}`);
      
      const productos = await obtenerDatosSheet('Productos');
      const producto = productos.find(p => p.producto_id == productoId);
      
      if (!producto) {
        await ctx.reply('❌ Producto no encontrado');
        return;
      }
      
      const userState = getUserState(userId);
      const cliente = userState.cliente;
      const precio = calcularPrecio(producto, cliente.lista || 1);
      
      const resultado = agregarProductoAlCarrito(userId, producto, cantidad, precio);
      
      if (!resultado.success) {
        await ctx.reply(`❌ ${resultado.message}`);
        return;
      }
      
      await ctx.reply(
        `✅ ${resultado.message}\n🛍️ ${producto.producto_nombre}\n📦 Cantidad: ${cantidad}\n💰 Subtotal: $${(precio * cantidad).toLocaleString()}\n\n🛒 Total carrito: ${resultado.totalItems} items - $${resultado.totalImporte.toLocaleString()}`,
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
      
      const keyboard = [];
      
      if (cart.length <= 10) {
        cart.forEach((item, index) => {
          keyboard.push([{
            text: `🗑️ ${item.producto_nombre.substring(0, 25)}${item.producto_nombre.length > 25 ? '...' : ''}`,
            callback_data: `eliminar|${index}`
          }]);
        });
        
        keyboard.push([{ text: '── ACCIONES ──', callback_data: 'separator' }]);
      }
      
      keyboard.push([{ text: '➕ Seguir comprando', callback_data: 'seguir_comprando' }]);
      keyboard.push([{ text: '✅ Finalizar pedido', callback_data: 'finalizar_pedido' }]);
      keyboard.push([{ text: '🗑️ Vaciar carrito', callback_data: 'vaciar_carrito' }]);
      
      await ctx.reply(mensaje, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });
      
    } else if (callbackData === 'finalizar_pedido') {
      const cart = getUserCart(userId);
      
      if (cart.length === 0) {
        await ctx.reply('❌ Tu carrito está vacío');
        return;
      }
      
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
      
    } else if (callbackData === 'noop') {
      // No hacer nada, es solo informativo
      return;
      
    } else if (callbackData === 'separator') {
      // No hacer nada, es solo visual
      return;
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
      const productos = await obtenerDatosSheet('Productos');
      const producto = productos.find(p => p.producto_id == productoId);
      
      if (!producto) {
        await ctx.reply('❌ Producto no encontrado');
        return;
      }
      
      const cliente = userState.cliente;
      const precio = calcularPrecio(producto, cliente.lista || 1);
      
      const resultado = agregarProductoAlCarrito(userId, producto, cantidad, precio);
      
      if (!resultado.success) {
        await ctx.reply(`❌ ${resultado.message}`);
        return;
      }
      
      setUserState(userId, { ...userState, step: 'seleccionar_categoria' });
      
      await ctx.reply(
        `✅ ${resultado.message}\n🛍️ ${producto.producto_nombre}\n📦 Cantidad: ${cantidad}\n💰 Subtotal: $${(precio * cantidad).toLocaleString()}\n\n🛒 Total carrito: ${resultado.totalItems} items - $${resultado.totalImporte.toLocaleString()}`,
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
      
      const clientes = await obtenerDatosSheet('Clientes');
      const clientesFiltrados = clientes.filter(cliente => {
        const nombre = (cliente.nombre || cliente.Nombre || '').toLowerCase();
        return nombre.includes(termino);
      });
      
      if (clientesFiltrados.length === 0) {
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
      
      const keyboard = clientesFiltrados.map(cliente => {
        const nombreCliente = cliente.nombre || cliente.Nombre || `Cliente ${cliente.cliente_id}`;
        const clienteId = cliente.cliente_id || cliente.Cliente_id || cliente.id;
        
        return [{
          text: `👤 ${nombreCliente}`,
          callback_data: `cliente_${clienteId}`
        }];
      });
      
      keyboard.push([{ text: '🔍 Buscar de nuevo', callback_data: 'buscar_cliente' }]);
      keyboard.push([{ text: '👥 Ver todos', callback_data: 'hacer_pedido' }]);
      
      await ctx.reply(`🔍 Encontrados ${clientesFiltrados.length} cliente(s):`, {
        reply_markup: { inline_keyboard: keyboard }
      });
      
    } else if (userState.step === 'buscar_producto') {
      const termino = text.toLowerCase().trim();
      
      if (termino.length < 2) {
        await ctx.reply('❌ Escribe al menos 2 caracteres para buscar');
        return;
      }
      
      const productos = await obtenerDatosSheet('Productos');
      console.log(`🔍 [buscar_producto] Productos obtenidos:`, typeof productos, Array.isArray(productos) ? productos.length : 'no es array');
      
      const categoriaId = userState.categoria_busqueda;
      const productosFiltrados = buscarProductos(productos, termino, categoriaId);
      
      if (productosFiltrados.length === 0) {
        await ctx.reply(`❌ No se encontraron productos con "${text}"`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔍 Buscar de nuevo', callback_data: `buscar|${categoriaId || 0}` }],
              [{ text: '📂 Ver categorías', callback_data: 'seguir_comprando' }]
            ]
          }
        });
        return;
      }
      
      await mostrarProductosPaginados(ctx, productosFiltrados, 1, categoriaId, termino);
      
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
      
      await confirmarPedido(ctx, userId, observacion);
      
    } else {
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
    
    const itemsTotal = cart.reduce((sum, item) => sum + item.cantidad, 0);
    const montoTotal = cart.reduce((sum, item) => sum + item.importe, 0);
    
    const fechaHora = new Date().toISOString();
    
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
    
    await agregarDatosSheet('Pedidos', pedidoData);
    
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
        item.importe
      ];
      
      await agregarDatosSheet('DetallePedidos', detalleData);
    }
    
    setUserState(userId, { step: 'idle' });
    setUserCart(userId, []);
    
    let mensaje = `✅ *Pedido registrado*\n\n`;
    mensaje += `📋 ID: ${pedidoId}\n`;
    mensaje += `👤 Cliente: ${cliente.nombre}\n`;
    mensaje += `📅 Fecha: ${fechaHora}\n`;
    mensaje += `📦 Items: ${itemsTotal}\n`;
    mensaje += `💰 Total: $${montoTotal.toLocaleString()}\n\n`;
    
    if (observacion) {
      mensaje += `📝 Observación: ${observacion}\n`;
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
    
    console.log(`✅ Pedido ${pedidoId} guardado exitosamente`);
    
  } catch (error) {
    console.error('❌ Error confirmando pedido:', error);
    await ctx.reply('❌ Error al confirmar el pedido. Intenta nuevamente.');
  }
}

// Configurar webhook
app.post('/webhook', (req, res) => {
  try {
    console.log('📨 Webhook recibido');
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
    port: PORT
  });
});

app.get('/api/info', (req, res) => {
  res.json({
    name: 'Sistema Distribuidora Bot',
    version: '1.0.0',
    status: 'running',
    features: [
      'Bot de Telegram',
      'Integración Google Sheets',
      'Sistema de pedidos',
      'Carrito de compras'
    ]
  });
});

app.get('/api/clientes', async (req, res) => {
  try {
    const clientes = await obtenerDatosSheet('Clientes');
    res.json({ success: true, clientes });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/productos', async (req, res) => {
  try {
    const productos = await obtenerDatosSheet('Productos');
    res.json({ success: true, productos });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/detalles-pedidos', async (req, res) => {
  try {
    const detalles = await obtenerDatosSheet('DetallePedidos');
    res.json({ success: true, detalles });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/pedidos-completos', async (req, res) => {
  try {
    console.log('📊 Obteniendo pedidos completos...');
    
    const pedidos = await obtenerDatosSheet('Pedidos');
    const detalles = await obtenerDatosSheet('DetallePedidos');
    
    console.log(`📋 Pedidos: ${pedidos.length}, Detalles: ${detalles.length}`);
    
    const pedidosCompletos = pedidos.map(pedido => {
      const pedidoId = pedido.pedido_id;
      
      const detallesPedido = detalles.filter(detalle => 
        detalle.pedido_id === pedidoId
      );
      
      const totalCalculado = detallesPedido.reduce((sum, detalle) => {
        const importe = parseFloat(detalle.importe) || 0;
        return sum + importe;
      }, 0);
      
      const totalFinal = parseFloat(pedido.total) || totalCalculado;
      
      return {
        ...pedido,
        total: totalFinal,
        total_calculado: totalCalculado,
        detalles: detallesPedido,
        cantidad_items: detallesPedido.length
      };
    });
    
    pedidosCompletos.sort((a, b) => {
      const fechaA = new Date(a.fecha_hora || 0);
      const fechaB = new Date(b.fecha_hora || 0);
      return fechaB - fechaA;
    });
    
    console.log(`✅ ${pedidosCompletos.length} pedidos completos procesados`);
    
    res.json({ 
      success: true, 
      pedidos: pedidosCompletos,
      total_pedidos: pedidosCompletos.length,
      total_detalles: detalles.length
    });
    
  } catch (error) {
    console.error('❌ Error obteniendo pedidos completos:', error);
    res.status(500).json({ success: false, error: error.message });
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
    
    const estadosPermitidos = ['PENDIENTE', 'CONFIRMADO', 'CANCELADO'];
    if (!estadosPermitidos.includes(estado.toUpperCase())) {
      return res.status(400).json({ 
        success: false, 
        error: 'Estado no válido. Debe ser: PENDIENTE, CONFIRMADO o CANCELADO' 
      });
    }
    
    if (!SPREADSHEET_ID) {
      console.log(`⚠️ Google Sheets no configurado, simulando actualización`);
      return res.json({ 
        success: true, 
        message: `Estado simulado actualizado a ${estado}`,
        pedido_id: pedidoId,
        nuevo_estado: estado
      });
    }
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Pedidos!A:Z',
    });
    
    const rows = response.data.values || [];
    if (rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'No se encontraron pedidos' 
      });
    }
    
    const headers = rows[0];
    const estadoColumnIndex = headers.findIndex(header => 
      header.toLowerCase() === 'estado'
    );
    
    if (estadoColumnIndex === -1) {
      return res.status(500).json({ 
        success: false, 
        error: 'Columna estado no encontrada' 
      });
    }
    
    let filaEncontrada = -1;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === pedidoId) {
        filaEncontrada = i;
        break;
      }
    }
    
    if (filaEncontrada === -1) {
      return res.status(404).json({ 
        success: false, 
        error: `Pedido ${pedidoId} no encontrado` 
      });
    }
    
    const estadoColumn = String.fromCharCode(65 + estadoColumnIndex);
    const range = `Pedidos!${estadoColumn}${filaEncontrada + 1}`;
    
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: range,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[estado.toUpperCase()]]
      }
    });
    
    console.log(`✅ Pedido ${pedidoId} actualizado a ${estado}`);
    
    res.json({ 
      success: true, 
      message: `Estado actualizado exitosamente`,
      pedido_id: pedidoId,
      nuevo_estado: estado.toUpperCase(),
      fila_actualizada: filaEncontrada + 1
    });
    
  } catch (error) {
    console.error('❌ Error actualizando estado:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
  console.log(`🌐 Dashboard: http://localhost:${PORT}`);
  console.log(`🤖 Bot de Telegram configurado`);
  console.log(`📊 Google Sheets: ${SPREADSHEET_ID ? 'Configurado' : 'No configurado'}`);
});

// Manejo de errores
process.on('uncaughtException', (error) => {
  console.error('❌ Error no capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promesa rechazada no manejada:', reason);
});