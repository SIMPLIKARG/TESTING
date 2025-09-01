import express from 'express';
import cors from 'cors';
import { Telegraf } from 'telegraf';
import { GoogleAuth } from 'google-auth-library';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import * as XLSX from 'xlsx';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware básico (SIN express.json global para evitar conflictos con multer)
app.use(cors());
app.use(express.static('public'));

// Configuración de multer para archivos XLSX
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
    fieldSize: 50 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    console.log('📁 Archivo recibido:', {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size
    });
    
    // Aceptar archivos XLSX
    const allowedMimes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel'
    ];
    
    if (allowedMimes.includes(file.mimetype) || file.originalname.endsWith('.xlsx')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos XLSX'), false);
    }
  }
});

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

// Función para parsear archivos XLSX
function parseXLSX(buffer, expectedHeaders) {
  try {
    console.log('📊 Parseando archivo XLSX...');
    
    // Leer el archivo XLSX desde el buffer
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    
    // Obtener la primera hoja
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    console.log(`📋 Hoja encontrada: "${sheetName}"`);
    
    // Convertir a JSON
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    if (jsonData.length === 0) {
      throw new Error('El archivo XLSX está vacío');
    }
    
    console.log(`📊 ${jsonData.length} filas encontradas`);
    
    // Verificar encabezados
    const headers = jsonData[0];
    console.log('📋 Encabezados encontrados:', headers);
    
    if (expectedHeaders) {
      const missingHeaders = expectedHeaders.filter(h => !headers.includes(h));
      if (missingHeaders.length > 0) {
        throw new Error(`Encabezados faltantes: ${missingHeaders.join(', ')}`);
      }
    }
    
    // Convertir filas a objetos
    const data = [];
    for (let i = 1; i < jsonData.length; i++) {
      const row = jsonData[i];
      
      // Saltar filas vacías
      if (!row || row.length === 0 || !row[0]) {
        continue;
      }
      
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = row[index] ? String(row[index]).trim() : '';
      });
      
      // Validar que el objeto tenga datos válidos
      const hasValidData = Object.values(obj).some(val => val && val !== '');
      if (hasValidData) {
        data.push(obj);
      }
    }
    
    console.log(`✅ ${data.length} registros válidos parseados`);
    return data;
    
  } catch (error) {
    console.error('❌ Error parseando XLSX:', error);
    throw new Error(`Error procesando archivo XLSX: ${error.message}`);
  }
}

// Función para obtener datos de Google Sheets
async function obtenerDatosSheet(nombreHoja) {
  try {
    if (!SPREADSHEET_ID) {
      throw new Error('Google Sheets no configurado. Configura GOOGLE_SHEETS_ID en las variables de entorno.');
    }

    console.log(`📊 Obteniendo ${nombreHoja} desde Google Sheets...`);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${nombreHoja}!A:Z`,
    });

    const rows = response.data.values || [];
    console.log(`📋 ${nombreHoja}: ${rows.length} filas obtenidas`);
    
    if (rows.length === 0) {
      console.log(`⚠️ ${nombreHoja} está vacía`);
      return [];
    }

    const headers = rows[0];
    console.log(`📋 Encabezados de ${nombreHoja}:`, headers);
    
    // Filtrar filas vacías y mapear datos
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
        // Filtrar objetos con datos válidos según la hoja
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

    console.log(`✅ ${nombreHoja}: ${data.length} registros válidos procesados`);
    return data;
  } catch (error) {
    console.error(`❌ Error obteniendo ${nombreHoja}:`, error.message);
    throw error; // Re-lanzar el error para que el endpoint pueda manejarlo
  }
}

// Función para agregar datos a Google Sheets
async function agregarDatosSheet(nombreHoja, datos) {
  try {
    if (!SPREADSHEET_ID) {
      throw new Error('Google Sheets no configurado');
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
    throw error;
  }
}

// Función para reemplazar datos completos en Google Sheets
async function reemplazarDatosSheet(nombreHoja, datos) {
  try {
    if (!SPREADSHEET_ID) {
      throw new Error('Google Sheets no configurado');
    }

    console.log(`🔄 Reemplazando datos en ${nombreHoja}...`);
    
    // Limpiar hoja primero
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `${nombreHoja}!A:Z`
    });
    
    // Insertar nuevos datos
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${nombreHoja}!A1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: datos
      }
    });

    console.log(`✅ ${nombreHoja} actualizada con ${datos.length - 1} registros`);
    return true;
  } catch (error) {
    console.error(`❌ Error reemplazando datos en ${nombreHoja}:`, error.message);
    throw error;
  }
}

// Función para calcular precio según lista del cliente
function calcularPrecio(producto, listaCliente) {
  const precioKey = `precio${listaCliente}`;
  return producto[precioKey] || producto.precio1 || 0;
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
        await ctx.reply('❌ No hay clientes disponibles. Configura Google Sheets primero.');
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
      for (const localidad of localidades) {
        const cantidadClientes = clientesAgrupados[localidad].length;
        keyboard.push([{
          text: `📍 ${localidad} (${cantidadClientes})`,
          callback_data: `localidad_${localidad}`
        }]);
      }
      
      await ctx.reply('👤 Selecciona el cliente:', {
        reply_markup: { inline_keyboard: keyboard }
      });
      
    } else if (callbackData === 'seguir_comprando') {
      const userState = getUserState(userId);
      const cliente = userState.cliente;
      const cart = getUserCart(userId);
      
      if (!cliente) {
        await ctx.reply('❌ Error: Cliente no seleccionado. Usa /start para comenzar.');
        return;
      }
      
      console.log(`🛒 ${userName} sigue comprando para ${cliente.nombre}`);
      
      const categorias = await obtenerDatosSheet('Categorias');
      
      const keyboard = categorias.map(cat => [{
        text: `📂 ${cat.categoria_nombre || cat.Categoria_nombre || 'Categoría'}`,
        callback_data: `categoria_${cat.categoria_id || cat.Categoria_id || cat.id}`
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
      console.log(`👤 Cliente seleccionado: ${clienteId}`);
      
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
      
      // Normalizar nombre del cliente
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
        text: `📂 ${cat.categoria_nombre || cat.Categoria_nombre || 'Categoría'}`,
        callback_data: `categoria_${cat.categoria_id || cat.Categoria_id || cat.id}`
      }]);
      
      keyboard.push([{ text: '🔍 Buscar producto', callback_data: 'buscar_producto_general' }]);
      keyboard.push([{ text: '🛒 Ver carrito', callback_data: 'ver_carrito' }]);
      
      await ctx.editMessageText(`✅ Cliente: ${nombreCliente}\n\n📂 Selecciona una categoría:`, {
        reply_markup: { inline_keyboard: keyboard }
      });
      
    } else if (callbackData.startsWith('localidad_')) {
      const localidad = decodeURIComponent(callbackData.split('_')[1]);
      console.log(`📍 Localidad seleccionada: ${localidad}`);
      
      const clientes = await obtenerDatosSheet('Clientes');
      const clientesLocalidad = clientes.filter(cliente => 
        (cliente.localidad || 'Sin localidad') === localidad
      );
      
      if (clientesLocalidad.length === 0) {
        await ctx.reply('❌ No hay clientes en esta localidad');
        return;
      }
      
      const keyboard = clientesLocalidad.map(cliente => {
        const nombreCliente = cliente.nombre || cliente.Nombre || `Cliente ${cliente.cliente_id}`;
        const clienteId = cliente.cliente_id || cliente.Cliente_id || cliente.id;
        
        return [{
          text: `👤 ${nombreCliente}`,
          callback_data: `cliente_${clienteId}`
        }];
      });
      
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
      console.log(`📂 Categoría seleccionada: ${categoriaId}`);
      
      const productos = await obtenerDatosSheet('Productos');
      const productosCategoria = productos.filter(p => p.categoria_id == categoriaId && p.activo === 'SI');
      
      if (productosCategoria.length === 0) {
        await ctx.reply('❌ No hay productos disponibles en esta categoría');
        return;
      }
      
      const categorias = await obtenerDatosSheet('Categorias');
      const categoria = categorias.find(c => c.categoria_id == categoriaId);
      const nombreCategoria = categoria ? categoria.categoria_nombre : 'Categoría';
      
      const keyboard = productosCategoria.map(producto => [{
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
      console.log(`🛍️ Producto seleccionado: ${productoId}`);
      
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
      
      console.log(`📦 Agregando al carrito: ${cantidad}x producto ${productoId}`);
      
      const productos = await obtenerDatosSheet('Productos');
      const producto = productos.find(p => p.producto_id == productoId);
      
      if (!producto) {
        await ctx.reply('❌ Producto no encontrado');
        return;
      }
      
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
      
      const keyboard = [
        [{ text: '➕ Seguir comprando', callback_data: 'seguir_comprando' }],
        [{ text: '✅ Finalizar pedido', callback_data: 'finalizar_pedido' }],
        [{ text: '🗑️ Vaciar carrito', callback_data: 'vaciar_carrito' }]
      ];
      
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
    }
    
  } catch (error) {
    console.error('❌ Error en callback:', error);
    await ctx.reply('❌ Ocurrió un error. Intenta nuevamente con /start');
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
      
    } else {
      // Mensaje no reconocido
      await ctx.reply(
        '❓ No entiendo ese mensaje. Usa /start para comenzar.',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🏠 Menú principal', callback_data: 'hacer_pedido' }]
            ]
          }
        }
      );
    }
    
  } catch (error) {
    console.error('❌ Error procesando mensaje:', error);
    await ctx.reply('❌ Ocurrió un error. Intenta nuevamente con /start');
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
    
    // Crear pedido en Google Sheets
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
        item.importe
      ];
      
      await agregarDatosSheet('DetallePedidos', detalleData);
    }
    
    // Limpiar estado del usuario
    setUserState(userId, { step: 'idle' });
    setUserCart(userId, []);
    
    // Mensaje de confirmación
    let mensaje = `✅ *Pedido registrado*\n\n`;
    mensaje += `📋 ID: ${pedidoId}\n`;
    mensaje += `👤 Cliente: ${cliente.nombre}\n`;
    mensaje += `📅 Fecha: ${new Date().toLocaleString()}\n`;
    mensaje += `📦 Items: ${itemsTotal}\n`;
    mensaje += `💰 Total: $${montoTotal.toLocaleString()}\n\n`;
    
    if (observacion) {
      mensaje += `📝 Observación: ${observacion}\n\n`;
    }
    
    mensaje += `🎉 ¡Pedido registrado exitosamente!`;
    
    await ctx.reply(mensaje, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🛒 Nuevo pedido', callback_data: 'hacer_pedido' }]
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
    console.log('📨 Webhook recibido de Telegram');
    bot.handleUpdate(req.body);
    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Error en webhook:', error);
    res.status(500).send('Error');
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    port: PORT,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.version
  });
});

// API Routes
app.get('/api/info', (req, res) => {
  res.json({
    name: 'Sistema Distribuidora Bot',
    version: '1.0.0',
    status: 'running',
    features: [
      'Bot de Telegram',
      'Integración Google Sheets',
      'Sistema de pedidos',
      'Carrito de compras',
      'Carga de archivos XLSX',
      'Métricas y estadísticas'
    ],
    endpoints: [
      '/api/clientes',
      '/api/productos',
      '/api/detalles-pedidos',
      '/api/upload-clientes-xlsx',
      '/api/upload-productos-xlsx',
      '/api/metricas'
    ]
  });
});

// Endpoint para obtener clientes
app.get('/api/clientes', async (req, res) => {
  try {
    console.log('📊 Obteniendo clientes...');
    const clientes = await obtenerDatosSheet('Clientes');
    res.json({ success: true, clientes, total: clientes.length });
  } catch (error) {
    console.error('❌ Error obteniendo clientes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint para obtener productos
app.get('/api/productos', async (req, res) => {
  try {
    console.log('📊 Obteniendo productos...');
    const productos = await obtenerDatosSheet('Productos');
    res.json({ success: true, productos, total: productos.length });
  } catch (error) {
    console.error('❌ Error obteniendo productos:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint para obtener detalles de pedidos
app.get('/api/detalles-pedidos', async (req, res) => {
  try {
    console.log('📊 Obteniendo detalles de pedidos...');
    const detalles = await obtenerDatosSheet('DetallePedidos');
    res.json({ success: true, detalles, total: detalles.length });
  } catch (error) {
    console.error('❌ Error obteniendo detalles:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint para cargar clientes desde XLSX
app.post('/api/upload-clientes-xlsx', upload.single('file'), async (req, res) => {
  try {
    console.log('📁 Iniciando carga de clientes XLSX...');
    
    if (!req.file) {
      console.log('❌ No se recibió archivo');
      return res.status(400).json({ 
        success: false, 
        error: 'No se recibió ningún archivo XLSX' 
      });
    }
    
    console.log('📁 Archivo recibido:', {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    });
    
    if (!SPREADSHEET_ID) {
      console.log('❌ Google Sheets no configurado');
      return res.status(500).json({ 
        success: false, 
        error: 'Google Sheets no configurado. Configura GOOGLE_SHEETS_ID.' 
      });
    }
    
    // Parsear archivo XLSX
    const expectedHeaders = ['cliente_id', 'nombre'];
    const clientes = parseXLSX(req.file.buffer, expectedHeaders);
    
    if (clientes.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'No se encontraron clientes válidos en el archivo' 
      });
    }
    
    console.log(`📊 Procesando ${clientes.length} clientes...`);
    
    // Preparar datos para Google Sheets (incluir encabezados)
    const headers = ['cliente_id', 'nombre', 'lista', 'localidad'];
    const datosParaSheet = [headers];
    
    for (const cliente of clientes) {
      const fila = [
        cliente.cliente_id || '',
        cliente.nombre || '',
        cliente.lista || '1',
        cliente.localidad || 'Sin localidad'
      ];
      datosParaSheet.push(fila);
    }
    
    // Reemplazar datos en Google Sheets
    await reemplazarDatosSheet('Clientes', datosParaSheet);
    
    console.log(`✅ ${clientes.length} clientes cargados exitosamente`);
    
    res.json({ 
      success: true, 
      message: `${clientes.length} clientes cargados exitosamente`,
      clientes_procesados: clientes.length,
      archivo: req.file.originalname
    });
    
  } catch (error) {
    console.error('❌ Error cargando clientes:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      details: 'Verifica que el archivo XLSX tenga las columnas: cliente_id, nombre'
    });
  }
});

// Endpoint para cargar productos desde XLSX
app.post('/api/upload-productos-xlsx', upload.single('file'), async (req, res) => {
  try {
    console.log('📁 Iniciando carga de productos XLSX...');
    
    if (!req.file) {
      console.log('❌ No se recibió archivo');
      return res.status(400).json({ 
        success: false, 
        error: 'No se recibió ningún archivo XLSX' 
      });
    }
    
    console.log('📁 Archivo recibido:', {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    });
    
    if (!SPREADSHEET_ID) {
      console.log('❌ Google Sheets no configurado');
      return res.status(500).json({ 
        success: false, 
        error: 'Google Sheets no configurado. Configura GOOGLE_SHEETS_ID.' 
      });
    }
    
    // Parsear archivo XLSX
    const expectedHeaders = ['producto_id', 'categoria_id', 'producto_nombre'];
    const productos = parseXLSX(req.file.buffer, expectedHeaders);
    
    if (productos.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'No se encontraron productos válidos en el archivo' 
      });
    }
    
    console.log(`📊 Procesando ${productos.length} productos...`);
    
    // Preparar datos para Google Sheets (incluir encabezados)
    const headers = ['producto_id', 'categoria_id', 'producto_nombre', 'precio1', 'precio2', 'precio3', 'precio4', 'precio5', 'activo'];
    const datosParaSheet = [headers];
    
    for (const producto of productos) {
      const fila = [
        producto.producto_id || '',
        producto.categoria_id || '',
        producto.producto_nombre || '',
        producto.precio1 || producto.precio || '0',
        producto.precio2 || producto.precio || '0',
        producto.precio3 || producto.precio || '0',
        producto.precio4 || producto.precio || '0',
        producto.precio5 || producto.precio || '0',
        producto.activo || 'SI'
      ];
      datosParaSheet.push(fila);
    }
    
    // Reemplazar datos en Google Sheets
    await reemplazarDatosSheet('Productos', datosParaSheet);
    
    console.log(`✅ ${productos.length} productos cargados exitosamente`);
    
    res.json({ 
      success: true, 
      message: `${productos.length} productos cargados exitosamente`,
      productos_procesados: productos.length,
      archivo: req.file.originalname
    });
    
  } catch (error) {
    console.error('❌ Error cargando productos:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      details: 'Verifica que el archivo XLSX tenga las columnas: producto_id, categoria_id, producto_nombre'
    });
  }
});

// Endpoint para obtener métricas
app.get('/api/metricas', async (req, res) => {
  try {
    console.log('📊 Calculando métricas...');
    
    // Obtener datos necesarios
    const productos = await obtenerDatosSheet('Productos');
    const categorias = await obtenerDatosSheet('Categorias');
    const detalles = await obtenerDatosSheet('DetallePedidos');
    
    console.log(`📊 Datos obtenidos: ${productos.length} productos, ${categorias.length} categorías, ${detalles.length} detalles`);
    
    // Calcular métricas por producto
    const metricas = productos.map(producto => {
      // Encontrar categoría
      const categoria = categorias.find(c => c.categoria_id == producto.categoria_id);
      
      // Calcular ventas de este producto
      const ventasProducto = detalles.filter(d => d.producto_id == producto.producto_id);
      
      const cantidadVendida = ventasProducto.reduce((sum, venta) => {
        return sum + (parseInt(venta.cantidad) || 0);
      }, 0);
      
      const ingresosTotales = ventasProducto.reduce((sum, venta) => {
        return sum + (parseFloat(venta.importe) || 0);
      }, 0);
      
      // Estimar costos (70% del precio de venta)
      const precioPromedio = parseFloat(producto.precio1) || 0;
      const costoEstimado = precioPromedio * 0.7;
      const costoTotal = costoEstimado * cantidadVendida;
      const gananciaTotal = ingresosTotales - costoTotal;
      const rentabilidad = ingresosTotales > 0 ? (gananciaTotal / ingresosTotales) * 100 : 0;
      
      return {
        producto_id: producto.producto_id,
        producto_nombre: producto.producto_nombre,
        categoria_id: producto.categoria_id,
        categoria_nombre: categoria ? categoria.categoria_nombre : 'Sin categoría',
        cantidad_vendida: cantidadVendida,
        ingresos_totales: Math.round(ingresosTotales),
        costo_total_estimado: Math.round(costoTotal),
        ganancia_total_estimada: Math.round(gananciaTotal),
        rentabilidad_porcentual: Math.round(rentabilidad * 100) / 100
      };
    });
    
    // Ordenar por ingresos totales (descendente)
    metricas.sort((a, b) => b.ingresos_totales - a.ingresos_totales);
    
    console.log(`✅ Métricas calculadas para ${metricas.length} productos`);
    
    res.json({ 
      success: true, 
      metricas,
      resumen: {
        total_productos: productos.length,
        productos_vendidos: metricas.filter(m => m.cantidad_vendida > 0).length,
        ingresos_totales: metricas.reduce((sum, m) => sum + m.ingresos_totales, 0),
        ganancia_total: metricas.reduce((sum, m) => sum + m.ganancia_total_estimada, 0)
      }
    });
    
  } catch (error) {
    console.error('❌ Error calculando métricas:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint para actualizar hoja de métricas
app.post('/api/actualizar-metricas', async (req, res) => {
  try {
    console.log('🔄 Actualizando hoja de métricas...');
    
    if (!SPREADSHEET_ID) {
      return res.status(500).json({ 
        success: false, 
        error: 'Google Sheets no configurado' 
      });
    }
    
    // Obtener métricas calculadas
    const metricsResponse = await fetch(`${req.protocol}://${req.get('host')}/api/metricas`);
    const metricsData = await metricsResponse.json();
    
    if (!metricsData.success) {
      throw new Error('Error obteniendo métricas');
    }
    
    const metricas = metricsData.metricas;
    
    // Preparar datos para la hoja de métricas
    const headers = [
      'producto_id',
      'producto_nombre', 
      'categoria_id',
      'categoria_nombre',
      'cantidad_vendida',
      'ingresos_totales',
      'costo_total_estimado',
      'ganancia_total_estimada',
      'rentabilidad_porcentual'
    ];
    
    const datosParaSheet = [headers];
    
    for (const metrica of metricas) {
      const fila = [
        metrica.producto_id,
        metrica.producto_nombre,
        metrica.categoria_id,
        metrica.categoria_nombre,
        metrica.cantidad_vendida,
        metrica.ingresos_totales,
        metrica.costo_total_estimado,
        metrica.ganancia_total_estimada,
        metrica.rentabilidad_porcentual
      ];
      datosParaSheet.push(fila);
    }
    
    // Actualizar hoja de métricas
    await reemplazarDatosSheet('Metricas', datosParaSheet);
    
    console.log(`✅ Hoja de métricas actualizada con ${metricas.length} productos`);
    
    res.json({ 
      success: true, 
      message: 'Hoja de métricas actualizada exitosamente',
      productos_actualizados: metricas.length,
      resumen: metricsData.resumen
    });
    
  } catch (error) {
    console.error('❌ Error actualizando métricas:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint para configurar webhook automáticamente
app.post('/api/setup-webhook', async (req, res) => {
  try {
    console.log('🔧 Configurando webhook automáticamente...');
    
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const baseUrl = process.env.RAILWAY_STATIC_URL || `${req.protocol}://${req.get('host')}`;
    
    if (!TELEGRAM_BOT_TOKEN) {
      return res.status(400).json({ 
        success: false, 
        error: 'TELEGRAM_BOT_TOKEN no configurado' 
      });
    }
    
    const webhookUrl = `${baseUrl}/webhook`;
    const apiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
    
    console.log(`🔗 Configurando webhook: ${webhookUrl}`);
    
    const response = await fetch(`${apiUrl}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: true
      })
    });
    
    const result = await response.json();
    
    if (result.ok) {
      console.log('✅ Webhook configurado exitosamente');
      res.json({ 
        success: true, 
        message: 'Webhook configurado exitosamente',
        webhook_url: webhookUrl
      });
    } else {
      throw new Error(result.description);
    }
    
  } catch (error) {
    console.error('❌ Error configurando webhook:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint para test de Google Sheets
app.get('/api/test/sheets', async (req, res) => {
  try {
    console.log('🧪 Probando conexión a Google Sheets...');
    
    if (!SPREADSHEET_ID) {
      return res.status(500).json({ 
        success: false, 
        error: 'GOOGLE_SHEETS_ID no configurado' 
      });
    }
    
    // Probar obtener información básica del spreadsheet
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID
    });
    
    const hojas = spreadsheet.data.sheets?.map(sheet => ({
      nombre: sheet.properties?.title,
      id: sheet.properties?.sheetId
    })) || [];
    
    console.log('✅ Conexión a Google Sheets exitosa');
    
    res.json({ 
      success: true, 
      message: 'Conexión a Google Sheets exitosa',
      spreadsheet_title: spreadsheet.data.properties?.title,
      hojas: hojas,
      spreadsheet_id: SPREADSHEET_ID
    });
    
  } catch (error) {
    console.error('❌ Error probando Google Sheets:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      details: 'Verifica las credenciales de Google Cloud y que la hoja esté compartida'
    });
  }
});

// Endpoint para actualizar estado de pedido (requiere express.json)
app.put('/api/pedidos/:pedidoId/estado', express.json(), async (req, res) => {
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
    
    if (!SPREADSHEET_ID) {
      return res.status(500).json({ 
        success: false, 
        error: 'Google Sheets no configurado' 
      });
    }
    
    // Obtener todos los pedidos
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
    
    // Buscar la fila del pedido
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
    
    // Actualizar el estado en Google Sheets
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

// Ruta principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
  console.log(`🌐 Dashboard: http://localhost:${PORT}`);
  console.log(`🤖 Bot de Telegram: ${process.env.TELEGRAM_BOT_TOKEN ? 'Configurado' : 'No configurado'}`);
  console.log(`📊 Google Sheets: ${SPREADSHEET_ID ? 'Configurado' : 'No configurado'}`);
  console.log('');
  console.log('📋 Endpoints disponibles:');
  console.log('   GET  /health - Health check');
  console.log('   GET  /api/info - Información de la API');
  console.log('   GET  /api/clientes - Obtener clientes');
  console.log('   GET  /api/productos - Obtener productos');
  console.log('   GET  /api/detalles-pedidos - Obtener detalles');
  console.log('   POST /api/upload-clientes-xlsx - Cargar clientes XLSX');
  console.log('   POST /api/upload-productos-xlsx - Cargar productos XLSX');
  console.log('   GET  /api/metricas - Obtener métricas');
  console.log('   POST /api/actualizar-metricas - Actualizar hoja métricas');
  console.log('   POST /api/setup-webhook - Configurar webhook');
  console.log('   GET  /api/test/sheets - Probar Google Sheets');
});

// Manejo de errores
process.on('uncaughtException', (error) => {
  console.error('❌ Error no capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promesa rechazada no manejada:', reason);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM recibido, cerrando servidor...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT recibido, cerrando servidor...');
  process.exit(0);
});