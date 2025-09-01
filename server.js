import express from 'express';
import cors from 'cors';
import { Telegraf } from 'telegraf';
import { GoogleAuth } from 'google-auth-library';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import XLSX from 'xlsx';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

// Configuración de multer para archivos
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos XLSX'));
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
const searchStates = new Map();

// Datos de ejemplo (fallback si no hay Google Sheets)
const datosEjemplo = {
  clientes: [
    { cliente_id: 1, nombre: 'Juan Pérez', lista: 1, localidad: 'Centro' },
    { cliente_id: 2, nombre: 'María González', lista: 2, localidad: 'Norte' },
    { cliente_id: 3, nombre: 'Carlos Rodríguez', lista: 1, localidad: 'Centro' },
    { cliente_id: 4, nombre: 'Ana Martínez', lista: 3, localidad: 'Sur' },
    { cliente_id: 5, nombre: 'Luis Fernández', lista: 2, localidad: 'Norte' }
  ],
  categorias: [
    { categoria_id: 1, categoria_nombre: 'Galletitas' },
    { categoria_id: 2, categoria_nombre: 'Bebidas' },
    { categoria_id: 3, categoria_nombre: 'Lácteos' },
    { categoria_id: 4, categoria_nombre: 'Panadería' },
    { categoria_id: 5, categoria_nombre: 'Conservas' }
  ],
  productos: [
    { producto_id: 1, categoria_id: 1, producto_nombre: 'Oreo Original 117g', precio1: 450, precio2: 420, precio3: 400, precio4: 380, precio5: 360, activo: 'SI' },
    { producto_id: 2, categoria_id: 1, producto_nombre: 'Pepitos Chocolate 100g', precio1: 380, precio2: 360, precio3: 340, precio4: 320, precio5: 300, activo: 'SI' },
    { producto_id: 3, categoria_id: 2, producto_nombre: 'Coca Cola 500ml', precio1: 350, precio2: 330, precio3: 310, precio4: 290, precio5: 270, activo: 'SI' },
    { producto_id: 4, categoria_id: 3, producto_nombre: 'Leche Entera 1L', precio1: 280, precio2: 260, precio3: 240, precio4: 220, precio5: 200, activo: 'SI' },
    { producto_id: 5, categoria_id: 4, producto_nombre: 'Pan Lactal 500g', precio1: 320, precio2: 300, precio3: 280, precio4: 260, precio5: 240, activo: 'SI' }
  ],
  detallepedidos: [
    { detalle_id: 'DET001', pedido_id: 'PED001', producto_id: 1, producto_nombre: 'Oreo Original 117g', categoria_id: 1, cantidad: 2, precio_unitario: 450, importe: 900 },
    { detalle_id: 'DET002', pedido_id: 'PED001', producto_id: 4, producto_nombre: 'Leche Entera 1L', categoria_id: 3, cantidad: 1, precio_unitario: 280, importe: 280 },
    { detalle_id: 'DET003', pedido_id: 'PED002', producto_id: 3, producto_nombre: 'Coca Cola 500ml', categoria_id: 2, cantidad: 1, precio_unitario: 350, importe: 350 }
  ]
};

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
    console.log(`📊 [obtenerDatosSheet] Iniciando obtención de ${nombreHoja}...`);
    
    if (!SPREADSHEET_ID) {
      console.log(`⚠️ [obtenerDatosSheet] Google Sheets no configurado, usando datos de ejemplo para ${nombreHoja}`);
      return datosEjemplo[nombreHoja.toLowerCase()] || [];
    }

    console.log(`📊 [obtenerDatosSheet] Conectando a Google Sheets para ${nombreHoja}...`);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${nombreHoja}!A:Z`,
    });

    const rows = response.data.values || [];
    console.log(`📋 [obtenerDatosSheet] ${nombreHoja}: ${rows.length} filas obtenidas`);
    
    if (rows.length === 0) {
      console.log(`⚠️ [obtenerDatosSheet] ${nombreHoja} está vacía, retornando array vacío`);
      return [];
    }

    const headers = rows[0];
    console.log(`📋 [obtenerDatosSheet] Encabezados de ${nombreHoja}:`, headers);
    
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
        if (nombreHoja === 'DetallePedidos') {
          return obj.detalle_id && obj.pedido_id;
        }
        return Object.values(obj).some(val => val && val !== '');
      });

    console.log(`✅ [obtenerDatosSheet] ${nombreHoja}: ${data.length} registros válidos procesados`);
    return data;
  } catch (error) {
    console.error(`❌ [obtenerDatosSheet] Error en ${nombreHoja}:`, error.message);
    console.error(`❌ [obtenerDatosSheet] Stack trace:`, error.stack);
    
    // Retornar datos de ejemplo en caso de error
    const fallbackData = datosEjemplo[nombreHoja.toLowerCase()] || [];
    console.log(`🔄 [obtenerDatosSheet] Usando datos de ejemplo para ${nombreHoja}: ${fallbackData.length} registros`);
    return fallbackData;
  }
}

// Función para agregar datos a Google Sheets
async function agregarDatosSheet(nombreHoja, datos) {
  try {
    console.log(`📝 [agregarDatosSheet] Agregando datos a ${nombreHoja}:`, datos);
    
    if (!SPREADSHEET_ID) {
      console.log(`⚠️ [agregarDatosSheet] Google Sheets no configurado, simulando inserción en ${nombreHoja}`);
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

    console.log(`✅ [agregarDatosSheet] Datos agregados exitosamente a ${nombreHoja}`);
    return true;
  } catch (error) {
    console.error(`❌ [agregarDatosSheet] Error agregando datos a ${nombreHoja}:`, error.message);
    return false;
  }
}

// Función para calcular precio según lista del cliente
function calcularPrecio(producto, listaCliente) {
  const precioKey = `precio${listaCliente}`;
  return producto[precioKey] || producto.precio1 || 0;
}

// Función para mostrar productos con paginación
async function mostrarProductosPaginados(ctx, productos, pagina = 1, titulo = 'Productos', categoriaId = null, esBusqueda = false, terminoBusqueda = '') {
  try {
    console.log(`📄 [mostrarProductosPaginados] Iniciando - productos tipo: ${typeof productos}, página: ${pagina}`);
    
    // Validar que productos sea un array
    if (!Array.isArray(productos)) {
      console.log(`⚠️ [mostrarProductosPaginados] productos no es array: ${typeof productos}`);
      productos = [];
    }
    
    const PRODUCTOS_POR_PAGINA = 8;
    const totalProductos = productos.length;
    const totalPaginas = Math.ceil(totalProductos / PRODUCTOS_POR_PAGINA);
    
    if (totalProductos === 0) {
      const mensaje = esBusqueda ? 
        `🔍 No se encontraron productos con "${terminoBusqueda}"` :
        `📂 No hay productos disponibles en ${titulo}`;
      
      const keyboard = esBusqueda ? [
        [{ text: '🔍 Buscar de nuevo', callback_data: categoriaId ? `buscar_producto_${categoriaId}` : 'buscar_producto_general' }],
        [{ text: '📂 Ver categorías', callback_data: 'seguir_comprando' }]
      ] : [
        [{ text: '📂 Ver categorías', callback_data: 'seguir_comprando' }]
      ];
      
      // Usar reply o editMessageText según el contexto
      if (ctx.callbackQuery) {
        await ctx.editMessageText(mensaje, { reply_markup: { inline_keyboard: keyboard } });
      } else {
        await ctx.reply(mensaje, { reply_markup: { inline_keyboard: keyboard } });
      }
      return;
    }
    
    // Validar página
    if (pagina < 1) pagina = 1;
    if (pagina > totalPaginas) pagina = totalPaginas;
    
    const inicio = (pagina - 1) * PRODUCTOS_POR_PAGINA;
    const fin = inicio + PRODUCTOS_POR_PAGINA;
    const productosPagina = productos.slice(inicio, fin);
    
    console.log(`📄 [mostrarProductosPaginados] Mostrando ${productosPagina.length} productos (${inicio}-${fin} de ${totalProductos})`);
    
    // Crear mensaje
    let mensaje = esBusqueda ? 
      `🔍 Resultados para "${terminoBusqueda}"\n` :
      `📂 ${titulo}\n`;
    
    mensaje += `📄 Página ${pagina} de ${totalPaginas} (${totalProductos} productos)\n\n`;
    
    // Crear keyboard con productos
    const keyboard = [];
    
    productosPagina.forEach(producto => {
      const nombreCorto = producto.producto_nombre.length > 35 ? 
        producto.producto_nombre.substring(0, 32) + '...' : 
        producto.producto_nombre;
      
      const precio = producto.precio1 || producto.precio || 0;
      const textoBoton = `${producto.producto_id} · ${nombreCorto} - $${precio}`;
      
      keyboard.push([{
        text: textoBoton,
        callback_data: `prod|${producto.producto_id}|${pagina}|${categoriaId || 0}`
      }]);
    });
    
    // Botones de navegación
    const navButtons = [];
    
    if (totalPaginas > 1) {
      if (pagina > 1) {
        const callbackAnterior = esBusqueda ? 
          `search|${categoriaId || 0}|${pagina - 1}|${encodeURIComponent(terminoBusqueda)}` :
          `cat|${categoriaId}|${pagina - 1}`;
        navButtons.push({ text: '⬅️ Anterior', callback_data: callbackAnterior });
      }
      
      if (pagina < totalPaginas) {
        const callbackSiguiente = esBusqueda ? 
          `search|${categoriaId || 0}|${pagina + 1}|${encodeURIComponent(terminoBusqueda)}` :
          `cat|${categoriaId}|${pagina + 1}`;
        navButtons.push({ text: 'Siguiente ➡️', callback_data: callbackSiguiente });
      }
      
      if (navButtons.length > 0) {
        keyboard.push(navButtons);
      }
    }
    
    // Botones de acción
    if (esBusqueda) {
      keyboard.push([{ text: '🔍 Nueva búsqueda', callback_data: categoriaId ? `buscar_producto_${categoriaId}` : 'buscar_producto_general' }]);
    } else {
      keyboard.push([{ text: '🔍 Buscar producto', callback_data: `buscar_producto_${categoriaId}` }]);
    }
    
    keyboard.push([{ text: '📂 Ver categorías', callback_data: 'seguir_comprando' }]);
    keyboard.push([{ text: '🛒 Ver carrito', callback_data: 'ver_carrito' }]);
    
    // Usar reply o editMessageText según el contexto
    if (ctx.callbackQuery) {
      await ctx.editMessageText(mensaje, { reply_markup: { inline_keyboard: keyboard } });
    } else {
      await ctx.reply(mensaje, { reply_markup: { inline_keyboard: keyboard } });
    }
    
  } catch (error) {
    console.error('❌ [mostrarProductosPaginados] Error:', error);
    const mensajeError = '❌ Error mostrando productos. Intenta nuevamente.';
    
    if (ctx.callbackQuery) {
      await ctx.editMessageText(mensajeError);
    } else {
      await ctx.reply(mensajeError);
    }
  }
}

// Función para buscar productos
function buscarProductos(productos, termino, categoriaId = null) {
  console.log(`🔍 [buscarProductos] Buscando "${termino}" en ${productos.length} productos`);
  
  if (!Array.isArray(productos)) {
    console.log(`⚠️ [buscarProductos] productos no es array: ${typeof productos}`);
    return [];
  }
  
  const terminoLower = termino.toLowerCase().trim();
  
  const resultados = productos.filter(producto => {
    // Verificar que el producto tenga los campos necesarios
    if (!producto.producto_nombre) return false;
    
    const nombre = producto.producto_nombre.toLowerCase();
    const id = producto.producto_id?.toString() || '';
    const activo = producto.activo === 'SI';
    const enCategoria = !categoriaId || producto.categoria_id == categoriaId;
    
    const coincideNombre = nombre.includes(terminoLower);
    const coincideId = id.includes(terminoLower);
    
    return (coincideNombre || coincideId) && activo && enCategoria;
  });
  
  console.log(`✅ [buscarProductos] ${resultados.length} productos encontrados`);
  return resultados;
}

// Función para exportar carrito a archivo TXT
function exportarCarrito(cliente, cart, pedidoId) {
  try {
    const fecha = new Date().toLocaleString('es-AR');
    const total = cart.reduce((sum, item) => sum + item.importe, 0);
    const totalItems = cart.reduce((sum, item) => sum + item.cantidad, 0);
    
    let contenido = `📋 PEDIDO - ${pedidoId}\n`;
    contenido += `═══════════════════════════════════════\n\n`;
    contenido += `👤 CLIENTE: ${cliente.nombre}\n`;
    contenido += `📅 FECHA: ${fecha}\n`;
    contenido += `📦 ITEMS: ${totalItems} productos\n`;
    contenido += `💰 TOTAL: $${total.toLocaleString()}\n\n`;
    contenido += `═══════════════════════════════════════\n`;
    contenido += `📋 DETALLE DEL PEDIDO:\n\n`;
    
    cart.forEach((item, index) => {
      contenido += `${index + 1}. ${item.producto_nombre}\n`;
      contenido += `   📦 Cantidad: ${item.cantidad}\n`;
      contenido += `   💰 Precio: $${item.precio_unitario.toLocaleString()} c/u\n`;
      contenido += `   💵 Subtotal: $${item.importe.toLocaleString()}\n\n`;
    });
    
    contenido += `═══════════════════════════════════════\n`;
    contenido += `💰 TOTAL FINAL: $${total.toLocaleString()}\n`;
    contenido += `═══════════════════════════════════════\n\n`;
    contenido += `📱 Generado por Sistema Distribuidora Bot\n`;
    contenido += `🕐 ${fecha}`;
    
    return {
      filename: `carrito_${cliente.nombre.replace(/\s+/g, '_')}_${pedidoId}.txt`,
      content: contenido
    };
    
  } catch (error) {
    console.error('❌ [exportarCarrito] Error:', error);
    return null;
  }
}
// Función para generar ID de pedido autoincremental
async function generarPedidoId() {
  try {
    if (!SPREADSHEET_ID) {
      return `PD${String(Date.now()).slice(-6).padStart(6, '0')}`;
    }

    const pedidos = await obtenerDatosSheet('Pedidos');
    
    // Encontrar el último número de pedido
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

// Función para agregar productos al carrito (reutilizable)
async function agregarAlCarrito(ctx, userId, productoId, cantidad) {
  try {
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
    
    // Verificar si el producto ya está en el carrito
    const itemExistente = cart.find(item => item.producto_id == productoId);
    
    if (itemExistente) {
      // Actualizar cantidad del producto existente
      itemExistente.cantidad += cantidad;
      itemExistente.importe = itemExistente.precio_unitario * itemExistente.cantidad;
      console.log(`📦 ${ctx.from.first_name} actualiza ${producto.producto_nombre}: ${itemExistente.cantidad} unidades`);
    } else {
      // Agregar nuevo producto al carrito
      cart.push({
        producto_id: productoId,
        producto_nombre: producto.producto_nombre,
        categoria_id: producto.categoria_id,
        cantidad: cantidad,
        precio_unitario: precio,
        importe: importe
      });
      console.log(`📦 ${ctx.from.first_name} agrega ${producto.producto_nombre}: ${cantidad} unidades`);
    }
    
    setUserCart(userId, cart);
    
    const totalCarrito = cart.reduce((sum, item) => sum + item.importe, 0);
    const totalItems = cart.reduce((sum, item) => sum + item.cantidad, 0);
    
    await ctx.reply(
      `✅ **Agregado al carrito:**\n🛍️ ${producto.producto_nombre}\n📦 Cantidad: ${cantidad}\n💰 Subtotal: $${importe.toLocaleString()}\n\n🛒 **Carrito:** ${totalItems} productos - $${totalCarrito.toLocaleString()}\n\n¿Qué más necesitas?`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '➕ Seguir comprando', callback_data: 'seguir_comprando' }],
            [{ text: '🛒 Ver carrito', callback_data: 'cart|1' }],
            [{ text: '✅ Finalizar pedido', callback_data: 'finalizar_pedido' }]
          ]
        }
      }
    );
    
  } catch (error) {
    console.error('❌ Error agregando al carrito:', error);
    await ctx.reply('❌ Error al agregar el producto. Intenta nuevamente.');
  }
}

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

// Función para buscar productos
function buscarProductos(productos, termino, categoriaId = null) {
  const terminoLower = termino.toLowerCase().trim();
  
  return productos.filter(producto => {
    // Verificar que el producto esté activo
    if (producto.activo !== 'SI') return false;
    
    // Filtrar por categoría si se especifica
    if (categoriaId && producto.categoria_id != categoriaId) return false;
    
    // Buscar en nombre del producto
    const nombre = (producto.producto_nombre || '').toLowerCase();
    const id = (producto.producto_id || '').toString();
    
    return nombre.includes(terminoLower) || id.includes(terminoLower);
  });
}

// Función para mostrar productos paginados
async function mostrarProductosPaginados(ctx, productos, categoriaId, nombreCategoria, paginaActual = 1, esResultadoBusqueda = false, terminoBusqueda = '') {
  const PRODUCTOS_POR_PAGINA = 8;
    // Validar que productos sea un array
    if (!Array.isArray(productos)) {
      console.log('⚠️ [mostrarProductosPaginados] productos no es array:', typeof productos);
      productos = [];
    }
    
  const totalProductos = productos.length;
  const totalPaginas = Math.ceil(totalProductos / PRODUCTOS_POR_PAGINA);
  
  // Validar página
  if (paginaActual < 1) paginaActual = 1;
  if (paginaActual > totalPaginas) paginaActual = totalPaginas;
  
  const inicio = (paginaActual - 1) * PRODUCTOS_POR_PAGINA;
  const fin = inicio + PRODUCTOS_POR_PAGINA;
  const productosPagina = productos.slice(inicio, fin);
  
  // Crear mensaje
  let mensaje = '';
  if (esResultadoBusqueda) {
    mensaje = `🔍 Resultados para "${terminoBusqueda}"\n`;
    mensaje += `📂 ${nombreCategoria || 'Todas las categorías'}\n\n`;
  } else {
    mensaje = `📂 ${nombreCategoria}\n\n`;
  }
  
  mensaje += `📦 ${totalProductos} productos`;
  if (totalPaginas > 1) {
    mensaje += ` - Página ${paginaActual} de ${totalPaginas}`;
  }
  mensaje += '\n\n';
  
  // Crear keyboard con productos
  const keyboard = [];
  
  productosPagina.forEach(producto => {
    const nombreCorto = producto.producto_nombre.length > 25 
      ? producto.producto_nombre.substring(0, 25) + '...'
      : producto.producto_nombre;
    
    keyboard.push([{
      text: `${producto.producto_id} · ${nombreCorto} - $${(producto.precio1 || 0).toLocaleString()}`,
      callback_data: `prod|${producto.producto_id}|${paginaActual}|${categoriaId}`
    }]);
  });
  
  // Botones de navegación
  const navButtons = [];
  
  if (totalPaginas > 1) {
    if (paginaActual > 1) {
      const callbackData = esResultadoBusqueda 
        ? `search_page|${categoriaId}|${paginaActual - 1}|${encodeURIComponent(terminoBusqueda)}`
        : `cat|${categoriaId}|${paginaActual - 1}`;
      navButtons.push({ text: '⬅️ Anterior', callback_data: callbackData });
    }
    
    if (paginaActual < totalPaginas) {
      const callbackData = esResultadoBusqueda 
        ? `search_page|${categoriaId}|${paginaActual + 1}|${encodeURIComponent(terminoBusqueda)}`
        : `cat|${categoriaId}|${paginaActual + 1}`;
      navButtons.push({ text: 'Siguiente ➡️', callback_data: callbackData });
    }
    
    if (navButtons.length > 0) {
      keyboard.push(navButtons);
    }
  }
  
  // Botones de acción
  const actionButtons = [];
  
  if (esResultadoBusqueda) {
    actionButtons.push({ text: '🔍 Nueva búsqueda', callback_data: `buscar|${categoriaId}` });
    if (categoriaId) {
      actionButtons.push({ text: '📂 Ver categoría', callback_data: `cat|${categoriaId}|1` });
    } else {
      actionButtons.push({ text: '📂 Categorías', callback_data: 'seguir_comprando' });
    }
  } else {
    actionButtons.push({ text: '🔍 Buscar', callback_data: `buscar|${categoriaId}` });
    actionButtons.push({ text: '📂 Categorías', callback_data: 'seguir_comprando' });
  }
  
  keyboard.push(actionButtons);
  keyboard.push([{ text: '🛒 Ver carrito', callback_data: 'ver_carrito' }]);
  
  return ctx.editMessageText(mensaje, {
    reply_markup: { inline_keyboard: keyboard }
  });
}

// Función para mostrar carrito paginado
async function mostrarCarritoPaginado(ctx, userId, paginaActual = 1) {
  const cart = getUserCart(userId);
  const ITEMS_POR_PAGINA = 5;
  
  if (cart.length === 0) {
    return ctx.editMessageText('🛒 Tu carrito está vacío', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🛍️ Empezar a comprar', callback_data: 'seguir_comprando' }]
        ]
      }
    });
  }
  
  const totalItems = cart.length;
  const totalPaginas = Math.ceil(totalItems / ITEMS_POR_PAGINA);
  
  // Validar página
  if (paginaActual < 1) paginaActual = 1;
  if (paginaActual > totalPaginas) paginaActual = totalPaginas;
  
  const inicio = (paginaActual - 1) * ITEMS_POR_PAGINA;
  const fin = inicio + ITEMS_POR_PAGINA;
  const itemsPagina = cart.slice(inicio, fin);
  
  // Calcular total del carrito
  const totalCarrito = cart.reduce((sum, item) => sum + item.importe, 0);
  const totalCantidad = cart.reduce((sum, item) => sum + item.cantidad, 0);
  
  // Crear mensaje
  let mensaje = `🛒 *Tu carrito* (${totalCantidad} productos)\n`;
  mensaje += `💰 *Total: $${totalCarrito.toLocaleString()}*\n\n`;
  
  if (totalPaginas > 1) {
    mensaje += `Página ${paginaActual} de ${totalPaginas}\n\n`;
  }
  
  // Mostrar items de la página actual
  itemsPagina.forEach((item, index) => {
    const numeroGlobal = inicio + index + 1;
    const nombreCorto = item.producto_nombre.length > 20 
      ? item.producto_nombre.substring(0, 20) + '...'
      : item.producto_nombre;
    
    mensaje += `${numeroGlobal}. *${nombreCorto}*\n`;
    mensaje += `   📦 ${item.cantidad} × $${item.precio_unitario.toLocaleString()} = $${item.importe.toLocaleString()}\n\n`;
  });
  
  // Crear keyboard
  const keyboard = [];
  
  // Controles para cada item de la página
  itemsPagina.forEach((item, index) => {
    const indiceGlobal = inicio + index;
    const nombreCorto = item.producto_nombre.length > 15 
      ? item.producto_nombre.substring(0, 15) + '...'
      : item.producto_nombre;
    
    keyboard.push([
      { text: '➖', callback_data: `cart_dec|${indiceGlobal}|${paginaActual}` },
      { text: `${item.cantidad}`, callback_data: `cart_info|${indiceGlobal}` },
      { text: '➕', callback_data: `cart_inc|${indiceGlobal}|${paginaActual}` },
      { text: '🗑️', callback_data: `cart_del|${indiceGlobal}|${paginaActual}` }
    ]);
  });
  
  // Navegación entre páginas
  if (totalPaginas > 1) {
    const navButtons = [];
    
    if (paginaActual > 1) {
      navButtons.push({ text: '⬅️ Anterior', callback_data: `cart_page|${paginaActual - 1}` });
    }
    
    if (paginaActual < totalPaginas) {
      navButtons.push({ text: 'Siguiente ➡️', callback_data: `cart_page|${paginaActual + 1}` });
    }
    
    if (navButtons.length > 0) {
      keyboard.push(navButtons);
    }
  }
  
  // Botones de acción
  keyboard.push([
    { text: '📄 Exportar', callback_data: 'exportar_carrito' },
    { text: '🗑️ Vaciar', callback_data: 'vaciar_carrito' }
  ]);
  
  keyboard.push([
    { text: '➕ Seguir comprando', callback_data: 'seguir_comprando' },
    { text: '✅ Finalizar pedido', callback_data: 'finalizar_pedido' }
  ]);
  
  return ctx.editMessageText(mensaje, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard }
  });
}

// Función para exportar carrito como archivo TXT
async function exportarCarrito(ctx, userId) {
  try {
    const userState = getUserState(userId);
    const cart = getUserCart(userId);
    const cliente = userState.cliente;
    
    if (!cliente || cart.length === 0) {
      await ctx.reply('❌ No hay carrito para exportar');
      return;
    }
    
    // Calcular totales
    const totalCantidad = cart.reduce((sum, item) => sum + item.cantidad, 0);
    const totalImporte = cart.reduce((sum, item) => sum + item.importe, 0);
    
    // Crear contenido del archivo
    let contenido = `🛒 CARRITO DE COMPRAS\n`;
    contenido += `═══════════════════════════════════════\n\n`;
    contenido += `👤 Cliente: ${cliente.nombre}\n`;
    contenido += `📅 Fecha: ${new Date().toLocaleString('es-AR')}\n`;
    contenido += `📋 ID Pedido: ${userState.pedido_id || 'Pendiente'}\n\n`;
    contenido += `═══════════════════════════════════════\n`;
    contenido += `📦 PRODUCTOS (${totalCantidad} items)\n`;
    contenido += `═══════════════════════════════════════\n\n`;
    
    cart.forEach((item, index) => {
      contenido += `${index + 1}. ${item.producto_nombre}\n`;
      contenido += `   📦 Cantidad: ${item.cantidad}\n`;
      contenido += `   💰 Precio unitario: $${item.precio_unitario.toLocaleString()}\n`;
      contenido += `   💵 Subtotal: $${item.importe.toLocaleString()}\n\n`;
    });
    
    contenido += `═══════════════════════════════════════\n`;
    contenido += `💰 TOTAL: $${totalImporte.toLocaleString()}\n`;
    contenido += `═══════════════════════════════════════\n\n`;
    contenido += `📱 Generado por Sistema Distribuidora Bot\n`;
    contenido += `🕐 ${new Date().toLocaleString('es-AR')}`;
    
    // Crear nombre de archivo
    const nombreCliente = cliente.nombre.replace(/[^a-zA-Z0-9]/g, '_');
    const pedidoId = userState.pedido_id || 'TEMP';
    const nombreArchivo = `carrito_${nombreCliente}_${pedidoId}.txt`;
    
    // Enviar archivo
    await ctx.replyWithDocument({
      source: Buffer.from(contenido, 'utf8'),
      filename: nombreArchivo
    }, {
      caption: `📄 Carrito exportado\n💰 Total: $${totalImporte.toLocaleString()}`,
      reply_markup: {
        inline_keyboard: [
          [{ text: '🛒 Ver carrito', callback_data: 'ver_carrito' }],
          [{ text: '✅ Finalizar pedido', callback_data: 'finalizar_pedido' }]
        ]
      }
    });
    
    console.log(`📄 Carrito exportado para ${cliente.nombre}: ${nombreArchivo}`);
    
  } catch (error) {
    console.error('❌ Error exportando carrito:', error);
    await ctx.reply('❌ Error al exportar el carrito. Intenta nuevamente.');
  }
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
      console.log(`📂 Categoría: ${categoriaId}`);
      
      const productos = await obtenerDatosSheet('Productos');
      console.log(`📊 [callback categoria] productos obtenidos: ${typeof productos}, length: ${Array.isArray(productos) ? productos.length : 'N/A'}`);
      
      console.log(`📦 [Callback] Productos obtenidos:`, typeof productos, Array.isArray(productos) ? productos.length : 'no es array');
      
      // Asegurar que productos sea un array
      const productosArray = Array.isArray(productos) ? productos : [];
      const productosCategoria = productosArray.filter(p => p.categoria_id == categoriaId && p.activo === 'SI');
      
      if (productosCategoria.length === 0) {
        await ctx.reply('❌ No hay productos disponibles en esta categoría');
        return;
      }
      
      const categorias = await obtenerDatosSheet('Categorias');
      const categoria = categorias.find(c => c.categoria_id == categoriaId);
      const nombreCategoria = categoria ? categoria.categoria_nombre : 'Categoría';
      
      // Usar paginación para productos
      const { mensaje, keyboard } = mostrarProductosPaginados(productosCategoria, categoriaId, 1, nombreCategoria);
      
      await ctx.editMessageText(mensaje, {
        reply_markup: { inline_keyboard: keyboard }
      });
      // Mostrar productos paginados
      await mostrarProductosPaginados(ctx, categoriaId, 1, nombreCategoria);
      
    } else if (callbackData.startsWith('cat|')) {
      // Nuevo formato compacto: cat|categoriaId|pagina
      const { id: categoriaId, pagina } = parsearCallbackCompacto(callbackData);
      console.log(`📂 Categoría ${categoriaId}, página ${pagina}`);
      
      const categorias = await obtenerDatosSheet('Categorias');
      const categoria = categorias.find(c => c.categoria_id == categoriaId);
      const nombreCategoria = categoria ? categoria.categoria_nombre : 'Categoría';
      
      await mostrarProductosPaginados(ctx, categoriaId, pagina, nombreCategoria);
      
    } else if (callbackData.startsWith('prod|')) {
      // Nuevo formato compacto: prod|productoId|pagina|categoriaId
      const { id: productoId, pagina, extra: categoriaId } = parsearCallbackCompacto(callbackData);
      console.log(`🛍️ Producto ${productoId} desde página ${pagina}`);
      
      await mostrarDetalleProducto(ctx, productoId, pagina, parseInt(categoriaId));
      
    } else if (callbackData.startsWith('qty|')) {
      // Nuevo formato compacto: qty|productoId|cantidad|pagina
      const { id: productoId, pagina, extra: cantidad } = parsearCallbackCompacto(callbackData);
      console.log(`📦 Agregando ${cantidad} del producto ${productoId}`);
      
      await agregarProductoAlCarrito(ctx, userId, productoId, parseInt(cantidad));
      
    } else if (callbackData.startsWith('nav|')) {
      // Navegación: nav|categoriaId|pagina|direccion
      const { id: categoriaId, pagina, extra: direccion } = parsearCallbackCompacto(callbackData);
      
      const nuevaPagina = direccion === 'next' ? pagina + 1 : pagina - 1;
      
      const categorias = await obtenerDatosSheet('Categorias');
      const categoria = categorias.find(c => c.categoria_id == categoriaId);
      const nombreCategoria = categoria ? categoria.categoria_nombre : 'Categoría';
      
      await mostrarProductosPaginados(ctx, categoriaId, nuevaPagina, nombreCategoria);
    } else if (callbackData.startsWith('cat|')) {
      // Manejo de paginación de categorías: cat|categoriaId|pagina
      const parts = callbackData.split('|');
      const categoriaId = parseInt(parts[1]);
      const pagina = parseInt(parts[2]) || 1;
      
      console.log(`📂 Categoría ${categoriaId}, página ${pagina}`);
      
      const productos = await obtenerDatosSheet('Productos');
      const productosCategoria = productos.filter(p => p.categoria_id == categoriaId && p.activo === 'SI');
      console.log(`📂 [callback categoria] productos filtrados: ${productosCategoria.length}`);
      
      if (productosCategoria.length === 0) {
        await ctx.editMessageText('❌ No hay productos disponibles en esta categoría', {
          reply_markup: {
            inline_keyboard: [[{ text: '📂 Ver categorías', callback_data: 'seguir_comprando' }]]
          }
        });
        return;
      }
      
      // Usar la función de paginación
      await mostrarProductosPaginados(ctx, productosCategoria, 1, `Categoría: ${nombreCategoria}`, categoriaId);
      const parts = callbackData.split('|');
      const productoId = parseInt(parts[1]);
      const paginaOrigen = parseInt(parts[2]) || 1;
      const contexto = parts[3]; // categoriaId o 'search'
      
      console.log(`🛍️ Producto ${productoId} desde página ${paginaOrigen}, contexto: ${contexto}`);
      
      const productos = await obtenerDatosSheet('Productos');
      const producto = productos.find(p => p.producto_id == productoId);
      
      if (!producto) {
        await ctx.editMessageText('❌ Producto no encontrado');
        return;
      }
      
      const userState = getUserState(userId);
      const cliente = userState.cliente;
      const precio = calcularPrecio(producto, cliente.lista || 1);
      
      // Determinar botón de volver según contexto
      let volverCallback;
      if (contexto === 'search') {
        volverCallback = 'search|all|0'; // Volver a búsqueda general
      } else {
        volverCallback = `cat|${contexto}|${paginaOrigen}`; // Volver a categoría y página específica
      }
      
      const keyboard = [
        [
          { text: '1️⃣', callback_data: `qty|${productoId}|${paginaOrigen}|1` },
          { text: '2️⃣', callback_data: `qty|${productoId}|${paginaOrigen}|2` },
          { text: '3️⃣', callback_data: `qty|${productoId}|${paginaOrigen}|3` }
        ],
        [
          { text: '5️⃣', callback_data: `qty|${productoId}|${paginaOrigen}|5` },
          { text: '🔟', callback_data: `qty|${productoId}|${paginaOrigen}|10` },
          { text: '🔢 Otra', callback_data: `custom|${productoId}|${paginaOrigen}` }
        ],
        [{ text: '🔙 Volver', callback_data: volverCallback }],
        [{ text: '🛒 Ver carrito', callback_data: 'cart|1' }]
      ];
      
      await ctx.editMessageText(
        `🛍️ **${producto.producto_nombre}**\n💰 Precio: $${precio.toLocaleString()}\n\n📦 ¿Cuántas unidades?`,
        { 
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: keyboard } 
        }
      );
      
    } else if (callbackData.startsWith('qty|')) {
      // Manejo de cantidades: qty|productoId|paginaOrigen|cantidad
      const parts = callbackData.split('|');
      const productoId = parseInt(parts[1]);
      const paginaOrigen = parseInt(parts[2]);
      const cantidad = parseInt(parts[3]);
      
      await agregarAlCarrito(ctx, userId, productoId, cantidad);
      
    } else if (callbackData.startsWith('custom|')) {
      // Cantidad personalizada: custom|productoId|paginaOrigen
      const parts = callbackData.split('|');
      const productoId = parseInt(parts[1]);
      const paginaOrigen = parseInt(parts[2]);
      
      setUserState(userId, { 
        ...getUserState(userId), 
        step: 'cantidad_custom', 
        producto_id: productoId,
        pagina_origen: paginaOrigen
      });
      
      await ctx.editMessageText('🔢 Escribe la cantidad que deseas:');
      
    } else if (callbackData.startsWith('cart|')) {
      // Ver carrito paginado: cart|pagina
      const pagina = parseInt(callbackData.split('|')[1]) || 1;
      const cart = getUserCart(userId);
      
      if (cart.length === 0) {
        await ctx.editMessageText('🛒 Tu carrito está vacío', {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🛍️ Empezar a comprar', callback_data: 'seguir_comprando' }]
            ]
          }
        });
        return;
      }
      
      const { mensaje, keyboard } = mostrarCarritoPaginado(cart, pagina, userId);
      
      await ctx.editMessageText(mensaje, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });
      
    } else if (callbackData.startsWith('cartmod|')) {
      // Modificar carrito: cartmod|indice|accion|pagina
      const parts = callbackData.split('|');
      const indice = parseInt(parts[1]);
      const accion = parts[2]; // 'inc', 'dec', 'del'
      const pagina = parseInt(parts[3]) || 1;
      
      const cart = getUserCart(userId);
      
      if (indice < 0 || indice >= cart.length) {
        await ctx.answerCbQuery('❌ Producto no encontrado');
        return;
      }
      
      const item = cart[indice];
      
      if (accion === 'inc') {
        item.cantidad += 1;
        item.importe = item.precio_unitario * item.cantidad;
        console.log(`➕ ${userName} incrementa ${item.producto_nombre} a ${item.cantidad}`);
        
      } else if (accion === 'dec') {
        if (item.cantidad > 1) {
          item.cantidad -= 1;
          item.importe = item.precio_unitario * item.cantidad;
          console.log(`➖ ${userName} decrementa ${item.producto_nombre} a ${item.cantidad}`);
        } else {
          await ctx.answerCbQuery('❌ Cantidad mínima es 1');
          return;
        }
        
      } else if (accion === 'del') {
        console.log(`🗑️ ${userName} elimina ${item.producto_nombre}`);
        cart.splice(indice, 1);
        
        // Si se eliminó el último producto, mostrar carrito vacío
        if (cart.length === 0) {
          await ctx.editMessageText('🗑️ Producto eliminado. Tu carrito está vacío.', {
            reply_markup: {
              inline_keyboard: [
                [{ text: '🛍️ Empezar a comprar', callback_data: 'seguir_comprando' }]
              ]
            }
          });
          setUserCart(userId, cart);
          return;
        }
        
        // Ajustar página si es necesaria
        const ITEMS_POR_PAGINA = 5;
        const totalPaginas = Math.ceil(cart.length / ITEMS_POR_PAGINA);
        if (pagina > totalPaginas) {
          pagina = totalPaginas;
        }
      }
      
      setUserCart(userId, cart);
      
      // Mostrar carrito actualizado
      const { mensaje, keyboard } = mostrarCarritoPaginado(cart, pagina, userId);
      
      await ctx.editMessageText(mensaje, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });
      
    } else if (callbackData.startsWith('search|')) {
      // Iniciar búsqueda: search|tipo|categoriaId
      const parts = callbackData.split('|');
      const tipo = parts[1]; // 'cat' o 'all'
      const categoriaId = parts[2] !== '0' ? parseInt(parts[2]) : null;
      
      setUserState(userId, { 
        ...getUserState(userId), 
        step: 'buscar_producto',
        categoria_busqueda: categoriaId,
        busqueda_tipo: tipo
      });
      
      const scope = categoriaId ? 'en esta categoría' : 'en todo el catálogo';
      await ctx.editMessageText(`🔍 Escribe el nombre del producto que buscas ${scope}:`);
      
    } else if (callbackData.startsWith('searchpage|')) {
      // Navegación de búsqueda: searchpage|termino|pagina|categoriaId
      const parts = callbackData.split('|');
      const termino = parts[1];
      const pagina = parseInt(parts[2]) || 1;
      const categoriaId = parts[3] !== 'all' ? parseInt(parts[3]) : null;
      
      const productos = await obtenerDatosSheet('Productos');
      const productosFiltrados = buscarProductos(productos, termino, categoriaId);
      
      if (productosFiltrados.length === 0) {
        await ctx.editMessageText(`❌ No se encontraron productos con "${termino}"`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔍 Nueva búsqueda', callback_data: categoriaId ? `search|cat|${categoriaId}` : 'search|all|0' }],
              [{ text: '📂 Ver categorías', callback_data: 'seguir_comprando' }]
            ]
          }
        });
        return;
      }
      
      const { mensaje, keyboard } = mostrarBusquedaPaginada(productosFiltrados, termino, pagina, categoriaId);
      
      await ctx.editMessageText(mensaje, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });
      
    } else if (callbackData === 'export_cart') {
      // Exportar carrito como archivo
      const cart = getUserCart(userId);
      const userState = getUserState(userId);
      const cliente = userState.cliente;
      
      if (!cart || cart.length === 0) {
        await ctx.answerCbQuery('❌ El carrito está vacío');
        return;
      }
      
      if (!cliente) {
        await ctx.answerCbQuery('❌ No hay cliente seleccionado');
        return;
      }
      
      const pedidoId = userState.pedido_id || 'TEMP';
      const contenidoArchivo = generarArchivoCarrito(cart, cliente, pedidoId);
      
      // Enviar como documento
      await ctx.replyWithDocument({
        source: Buffer.from(contenidoArchivo, 'utf8'),
        filename: `carrito_${cliente.nombre.replace(/\s+/g, '_')}_${pedidoId}.txt`
      }, {
        caption: `📄 Carrito completo para ${cliente.nombre}\n💰 Total: $${cart.reduce((sum, item) => sum + item.importe, 0).toLocaleString()}`,
        reply_markup: {
          inline_keyboard: [
            [{ text: '🛒 Volver al carrito', callback_data: 'cart|1' }],
            [{ text: '✅ Finalizar pedido', callback_data: 'finalizar_pedido' }]
          ]
        }
      });
      
      console.log(`📄 ${userName} exportó carrito con ${cart.length} productos`);
      
    } else if (callbackData.startsWith('producto_')) {
      const productoId = parseInt(callbackData.split('_')[1]);
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
      // Redirigir a carrito paginado
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
      
      const { mensaje, keyboard } = mostrarCarritoPaginado(cart, 1, userId);
      
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
      const parts = callbackData.split('_');
      const categoriaId = parts[2] === 'general' ? null : parseInt(parts[2]);
      
      console.log(`🔍 [callback buscar] categoriaId: ${categoriaId}`);
      
      setUserState(userId, { 
        ...getUserState(userId), 
        step: 'buscar_producto',
        categoria_busqueda: categoriaId
      });
      
      const mensaje = categoriaId ? 
        '🔍 Escribe el nombre del producto que buscas en esta categoría:' :
        '🔍 Escribe el nombre del producto que buscas (en todas las categorías):';
      
      if (ctx.callbackQuery) {
        await ctx.editMessageText(mensaje);
      } else {
        await ctx.reply(mensaje);
      }
      
    } else if (callbackData.startsWith('cat|')) {
      // Navegación de paginación de categoría: cat|categoriaId|pagina
      const [, categoriaId, pagina] = callbackData.split('|');
      console.log(`📄 [callback paginación] cat|${categoriaId}|${pagina}`);
      
      const productos = await obtenerDatosSheet('Productos');
      const productosCategoria = productos.filter(p => p.categoria_id == categoriaId && p.activo === 'SI');
      
      const categorias = await obtenerDatosSheet('Categorias');
      const categoria = categorias.find(c => c.categoria_id == categoriaId);
      const nombreCategoria = categoria ? categoria.categoria_nombre : 'Categoría';
      
      await mostrarProductosPaginados(ctx, productosCategoria, parseInt(pagina), `Categoría: ${nombreCategoria}`, categoriaId);
      
    } else if (callbackData.startsWith('search|')) {
      // Navegación de resultados de búsqueda: search|categoriaId|pagina|termino
      const [, categoriaId, pagina, terminoEncoded] = callbackData.split('|');
      const termino = decodeURIComponent(terminoEncoded);
      
      console.log(`🔍 [callback búsqueda] search|${categoriaId}|${pagina}|${termino}`);
      
      const productos = await obtenerDatosSheet('Productos');
      const resultados = buscarProductos(productos, termino, categoriaId === '0' ? null : parseInt(categoriaId));
      
      await mostrarProductosPaginados(ctx, resultados, parseInt(pagina), 'Resultados de búsqueda', categoriaId === '0' ? null : parseInt(categoriaId), true, termino);
      
    } else if (callbackData.startsWith('prod|')) {
      // Ver producto: prod|productoId|paginaOrigen|categoriaId
      const [, productoId, paginaOrigen, categoriaId] = callbackData.split('|');
      console.log(`🛍️ [callback producto] prod|${productoId}|${paginaOrigen}|${categoriaId}`);
      
      const productos = await obtenerDatosSheet('Productos');
      const producto = productos.find(p => p.producto_id == productoId);
      
      if (!producto) {
        await ctx.editMessageText('❌ Producto no encontrado');
        return;
      }
      
      const userState = getUserState(userId);
      const cliente = userState.cliente;
      const precio = calcularPrecio(producto, cliente.lista || 1);
      
      const keyboard = [
        [
          { text: '1️⃣', callback_data: `qty|${productoId}|${paginaOrigen}|1` },
          { text: '2️⃣', callback_data: `qty|${productoId}|${paginaOrigen}|2` },
          { text: '3️⃣', callback_data: `qty|${productoId}|${paginaOrigen}|3` }
        ],
        [
          { text: '5️⃣', callback_data: `qty|${productoId}|${paginaOrigen}|5` },
          { text: '🔟', callback_data: `qty|${productoId}|${paginaOrigen}|10` },
          { text: '🔢 Otra', callback_data: `custom|${productoId}|${paginaOrigen}|${categoriaId}` }
        ],
        [{ text: '🔙 Volver', callback_data: `cat|${categoriaId}|${paginaOrigen}` }]
      ];
      
      await ctx.editMessageText(
        `🛍️ ${producto.producto_nombre}\n💰 Precio: $${precio.toLocaleString()}\n\n¿Cuántas unidades?`,
        { reply_markup: { inline_keyboard: keyboard } }
      );
      
    } else if (callbackData.startsWith('qty|')) {
      // Agregar cantidad: qty|productoId|paginaOrigen|cantidad
      const [, productoId, paginaOrigen, cantidad] = callbackData.split('|');
      console.log(`📦 [callback cantidad] qty|${productoId}|${paginaOrigen}|${cantidad}`);
      
      await agregarProductoAlCarrito(ctx, userId, parseInt(productoId), parseInt(cantidad));
      
    } else if (callbackData.startsWith('custom|')) {
      // Cantidad personalizada: custom|productoId|paginaOrigen|categoriaId
      const [, productoId, paginaOrigen, categoriaId] = callbackData.split('|');
      
      setUserState(userId, { 
        ...getUserState(userId), 
        step: 'cantidad_custom', 
        producto_id: parseInt(productoId),
        pagina_origen: parseInt(paginaOrigen),
        categoria_origen: parseInt(categoriaId)
      });
      
      await ctx.editMessageText('🔢 Escribe la cantidad que deseas:');
    }
    
  } catch (error) {
    console.error('❌ Error en callback:', error);
    await ctx.reply('❌ Ocurrió un error. Intenta nuevamente.');
  }
});

// Función auxiliar para agregar producto al carrito
async function agregarProductoAlCarrito(ctx, userId, productoId, cantidad) {
  try {
    const productos = await obtenerDatosSheet('Productos');
    const producto = productos.find(p => p.producto_id == productoId);
    
    if (!producto) {
      await ctx.editMessageText('❌ Producto no encontrado');
      return;
    }
    
    const userState = getUserState(userId);
    const cliente = userState.cliente;
    const precio = calcularPrecio(producto, cliente.lista || 1);
    const importe = precio * cantidad;
    
    const cart = getUserCart(userId);
    
    // Verificar si el producto ya está en el carrito
    const existingIndex = cart.findIndex(item => item.producto_id == productoId);
    
    if (existingIndex !== -1) {
      // Actualizar cantidad existente
      cart[existingIndex].cantidad += cantidad;
      cart[existingIndex].importe = cart[existingIndex].precio_unitario * cart[existingIndex].cantidad;
    } else {
      // Agregar nuevo producto
      cart.push({
        producto_id: productoId,
        producto_nombre: producto.producto_nombre,
        categoria_id: producto.categoria_id,
        cantidad: cantidad,
        precio_unitario: precio,
        importe: importe
      });
    }
    
    setUserCart(userId, cart);
    
    const totalCarrito = cart.reduce((sum, item) => sum + item.importe, 0);
    const itemsCarrito = cart.reduce((sum, item) => sum + item.cantidad, 0);
    
    await ctx.editMessageText(
      `✅ Agregado al carrito:\n🛍️ ${producto.producto_nombre}\n📦 Cantidad: ${cantidad}\n💰 Subtotal: $${importe.toLocaleString()}\n\n🛒 Carrito: ${itemsCarrito} items - $${totalCarrito.toLocaleString()}\n\n¿Qué más necesitas?`,
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
    
  } catch (error) {
    console.error('❌ [agregarProductoAlCarrito] Error:', error);
    await ctx.editMessageText('❌ Error agregando producto. Intenta nuevamente.');
  }
}

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
      
      if (cantidad > 999) {
        await ctx.reply('❌ Cantidad máxima: 999 unidades');
        return;
        producto_id: null,
        pagina_origen: null
      });
      
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
      
      console.log(`🔍 [text buscar_producto] Buscando: "${termino}"`);
      
      const productos = await obtenerDatosSheet('Productos');
      console.log(`📊 [text buscar_producto] productos obtenidos: ${typeof productos}, length: ${Array.isArray(productos) ? productos.length : 'N/A'}`);
      
      console.log(`📦 [Text] Productos para búsqueda:`, typeof productos, Array.isArray(productos) ? productos.length : 'no es array');
      
      const categoriaId = userState.categoria_busqueda;
      if (resultados.length === 0) {
        const scope = categoriaId ? 'en esta categoría' : 'en el catálogo';
        await ctx.reply(`❌ No se encontraron productos con "${text}" ${scope}`, {
          reply_markup: {
            inline_keyboard: [
      // Mostrar resultados paginados
      await mostrarProductosPaginados(ctx, resultados, 1, 'Resultados de búsqueda', categoriaId, true, termino);
      
      // Limpiar estado de búsqueda
      setUserState(userId, { 
        ...userState, 
        step: 'seleccionar_categoria' 
      });
    } else if (userState.step === 'escribir_observacion') {
      const productoId = userState.producto_id;
      await agregarProductoAlCarrito(ctx, userId, productoId, cantidad);
      
      // Limpiar estado
      setUserState(userId, { ...userState, step: 'seleccionar_categoria' });
    }
    
  } catch (error) {
    console.error('❌ Error procesando mensaje:', error);
    await ctx.reply('❌ Ocurrió un error. Intenta nuevamente.');
  }
});

// Configurar webhook con validación mejorada
app.post('/webhook', (req, res) => {
  try {
    console.log('📨 [Webhook] Recibido de Telegram');
    console.log('📨 [Webhook] Headers:', JSON.stringify(req.headers, null, 2));
    console.log('📨 [Webhook] Body type:', typeof req.body);
    console.log('📨 [Webhook] Body keys:', Object.keys(req.body || {}));
    
    // Validar que el body existe y tiene la estructura esperada
    if (!req.body) {
      console.error('❌ [Webhook] req.body está vacío o undefined');
      return res.status(400).json({ error: 'Body vacío' });
    }
    
    if (typeof req.body !== 'object') {
      console.error('❌ [Webhook] req.body no es un objeto:', typeof req.body);
      return res.status(400).json({ error: 'Body inválido' });
    }
    
    if (!req.body.update_id) {
      console.error('❌ [Webhook] update_id faltante en req.body:', req.body);
      return res.status(400).json({ error: 'update_id faltante' });
    }
    
    console.log('✅ [Webhook] Estructura válida, procesando con Telegraf...');
    console.log('📨 [Webhook] Update ID:', req.body.update_id);
    
    bot.handleUpdate(req.body);
    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ [Webhook] Error procesando:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// API Routes
app.get('/health', async (req, res) => {
  try {
    console.log('🏥 [Health] Verificando estado del sistema...');
    
    // Verificar configuración básica
    const config = {
      google_sheets_configured: !!SPREADSHEET_ID,
      google_service_account_configured: !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      google_private_key_configured: !!process.env.GOOGLE_PRIVATE_KEY,
      telegram_bot_configured: !!process.env.TELEGRAM_BOT_TOKEN,
      node_env: process.env.NODE_ENV || 'development'
    };
    
    // Intentar conexión básica a Google Sheets si está configurado
    let sheets_status = 'not_configured';
    if (config.google_sheets_configured) {
      try {
        console.log('🏥 [Health] Probando conexión a Google Sheets...');
        const response = await sheets.spreadsheets.get({
          spreadsheetId: SPREADSHEET_ID
        });
        sheets_status = 'connected';
        console.log('✅ [Health] Google Sheets conectado exitosamente');
      } catch (error) {
        sheets_status = `error: ${error.message}`;
        console.error('❌ [Health] Error conectando a Google Sheets:', error.message);
      }
    }
    
    const healthData = {
      status: 'OK',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      port: PORT,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.version,
      configuration: config,
      google_sheets_status: sheets_status
    };
    
    console.log('✅ [Health] Estado del sistema verificado');
    res.json(healthData);
  } catch (error) {
    console.error('❌ [Health] Error en health check:', error);
    res.status(500).json({
      status: 'ERROR',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
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

app.get('/api/test/sheets', async (req, res) => {
  try {
    console.log('🧪 [Test] Iniciando prueba de Google Sheets...');
    
    if (!SPREADSHEET_ID) {
      return res.json({
        success: false,
        error: 'GOOGLE_SHEETS_ID no configurado',
        using_fallback: true
      });
    }
    
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
      return res.json({
        success: false,
        error: 'GOOGLE_SERVICE_ACCOUNT_EMAIL no configurado'
      });
    }
    
    if (!process.env.GOOGLE_PRIVATE_KEY) {
      return res.json({
        success: false,
        error: 'GOOGLE_PRIVATE_KEY no configurado'
      });
    }
    
    console.log('🧪 [Test] Credenciales presentes, probando conexión...');
    
    // Probar conexión básica
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID
    });
    
    console.log('✅ [Test] Conexión exitosa a Google Sheets');
    
    // Probar lectura de hojas
    const hojas = spreadsheet.data.sheets?.map(sheet => sheet.properties?.title) || [];
    console.log('📋 [Test] Hojas disponibles:', hojas);
    
    // Probar lectura de DetallePedidos específicamente
    let detallePedidosTest = null;
    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'DetallePedidos!A:Z',
      });
      
      const rows = response.data.values || [];
      detallePedidosTest = {
        exists: true,
        rows_count: rows.length,
        headers: rows[0] || [],
        sample_data: rows.slice(1, 3) // Primeras 2 filas de datos
      };
      
      console.log('✅ [Test] DetallePedidos leída exitosamente');
    } catch (error) {
      detallePedidosTest = {
        exists: false,
        error: error.message
      };
      console.error('❌ [Test] Error leyendo DetallePedidos:', error.message);
    }
    
    res.json({
      success: true,
      spreadsheet_title: spreadsheet.data.properties?.title,
      spreadsheet_id: SPREADSHEET_ID,
      sheets_available: hojas,
      detalle_pedidos_test: detallePedidosTest,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ [Test] Error en prueba de Google Sheets:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      error_code: error.code,
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/api/clientes', async (req, res) => {
  try {
    console.log('👥 [API] Obteniendo clientes...');
    const clientes = await obtenerDatosSheet('Clientes');
    console.log(`✅ [API] ${clientes.length} clientes obtenidos`);
    res.json({ success: true, clientes });
  } catch (error) {
    console.error('❌ [API] Error obteniendo clientes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/productos', async (req, res) => {
  try {
    console.log('📦 [API] Obteniendo productos...');
    const productos = await obtenerDatosSheet('Productos');
    console.log(`✅ [API] ${productos.length} productos obtenidos`);
    res.json({ success: true, productos });
  } catch (error) {
    console.error('❌ [API] Error obteniendo productos:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/detalles-pedidos', async (req, res) => {
  try {
    console.log('📋 [API] Iniciando obtención de detalles de pedidos...');
    
    // Verificar configuración antes de intentar conectar
    if (!SPREADSHEET_ID) {
      console.log('⚠️ [API] SPREADSHEET_ID no configurado, usando datos de ejemplo');
      const detallesEjemplo = datosEjemplo.detallepedidos || [];
      return res.json({ 
        success: true, 
        detalles: detallesEjemplo,
        message: 'Usando datos de ejemplo (Google Sheets no configurado)',
        source: 'fallback'
      });
    }
    
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
      console.log('⚠️ [API] Credenciales de Google no configuradas');
      return res.status(500).json({ 
        success: false, 
        error: 'Credenciales de Google Sheets no configuradas' 
      });
    }
    
    console.log('📊 [API] Obteniendo DetallePedidos de Google Sheets...');
    const detalles = await obtenerDatosSheet('DetallePedidos');
    
    console.log(`✅ [API] ${detalles.length} detalles de pedidos obtenidos exitosamente`);
    
    res.json({ 
      success: true, 
      detalles,
      total_registros: detalles.length,
      source: 'google_sheets'
    });
    
  } catch (error) {
    console.error('❌ [API] Error crítico obteniendo detalles de pedidos:', error);
    console.error('❌ [API] Stack trace:', error.stack);
    
    // En caso de error, intentar retornar datos de ejemplo
    try {
      const detallesEjemplo = datosEjemplo.detallepedidos || [];
      console.log(`🔄 [API] Retornando ${detallesEjemplo.length} registros de ejemplo como fallback`);
      
      res.json({ 
        success: true, 
        detalles: detallesEjemplo,
        message: `Error conectando a Google Sheets: ${error.message}`,
        source: 'fallback'
      });
    } catch (fallbackError) {
      console.error('❌ [API] Error incluso con datos de ejemplo:', fallbackError);
      res.status(500).json({ 
        success: false, 
        error: error.message,
        fallback_error: fallbackError.message
      });
    }
  }
});

app.get('/api/pedidos-completos', async (req, res) => {
  try {
    console.log('📊 [API] Obteniendo pedidos completos...');
    
    // Obtener datos de ambas hojas
    const pedidos = await obtenerDatosSheet('Pedidos');
    const detalles = await obtenerDatosSheet('DetallePedidos');
    
    console.log(`📋 [API] Pedidos: ${pedidos.length}, Detalles: ${detalles.length}`);
    
    // Combinar pedidos con sus detalles
    const pedidosCompletos = pedidos.map(pedido => {
      const pedidoId = pedido.pedido_id;
      
      // Encontrar todos los detalles de este pedido
      const detallesPedido = detalles.filter(detalle => 
        detalle.pedido_id === pedidoId
      );
      
      // Calcular total desde los detalles si no existe o es incorrecto
      const totalCalculado = detallesPedido.reduce((sum, detalle) => {
        const importe = parseFloat(detalle.importe) || 0;
        return sum + importe;
      }, 0);
      
      // Usar el total calculado si el total del pedido no existe o es 0
      const totalFinal = parseFloat(pedido.total) || totalCalculado;
      
      return {
        ...pedido,
        total: totalFinal,
        total_calculado: totalCalculado,
        detalles: detallesPedido,
        cantidad_items: detallesPedido.length
      };
    });
    
    // Ordenar por fecha más reciente primero
    pedidosCompletos.sort((a, b) => {
      const fechaA = new Date(a.fecha_hora || 0);
      const fechaB = new Date(b.fecha_hora || 0);
      return fechaB - fechaA;
    });
    
    console.log(`✅ [API] ${pedidosCompletos.length} pedidos completos procesados`);
    
    res.json({ 
      success: true, 
      pedidos: pedidosCompletos,
      total_pedidos: pedidosCompletos.length,
      total_detalles: detalles.length
    });
    
  } catch (error) {
    console.error('❌ [API] Error obteniendo pedidos completos:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint para actualizar estado del pedido
app.put('/api/pedidos/:pedidoId/estado', async (req, res) => {
  try {
    const { pedidoId } = req.params;
    const { estado } = req.body;
    
    console.log(`🔄 [API] Actualizando pedido ${pedidoId} a estado: ${estado}`);
    
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
      console.log(`⚠️ [API] Google Sheets no configurado, simulando actualización`);
      return res.json({ 
        success: true, 
        message: `Estado simulado actualizado a ${estado}`,
        pedido_id: pedidoId,
        nuevo_estado: estado
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
      if (rows[i][0] === pedidoId) { // Asumiendo que pedido_id está en columna A
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
    const estadoColumn = String.fromCharCode(65 + estadoColumnIndex); // A=65, B=66, etc.
    const range = `Pedidos!${estadoColumn}${filaEncontrada + 1}`;
    
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: range,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[estado.toUpperCase()]]
      }
    });
    
    console.log(`✅ [API] Pedido ${pedidoId} actualizado a ${estado}`);
    
    res.json({ 
      success: true, 
      message: `Estado actualizado exitosamente`,
      pedido_id: pedidoId,
      nuevo_estado: estado.toUpperCase(),
      fila_actualizada: filaEncontrada + 1
    });
    
  } catch (error) {
    console.error('❌ [API] Error actualizando estado:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Endpoint para cargar clientes desde XLSX
app.post('/api/upload-clientes-xlsx', upload.single('file'), async (req, res) => {
  try {
    console.log('📤 [Upload] Procesando archivo de clientes...');
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No se recibió ningún archivo'
      });
    }
    
    console.log('📁 [Upload] Archivo recibido:', req.file.originalname);
    
    // Leer archivo XLSX
    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    console.log(`📊 [Upload] ${data.length} filas procesadas del XLSX`);
    
    if (data.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'El archivo está vacío o no tiene datos válidos'
      });
    }
    
    // Validar estructura mínima
    const primeraFila = data[0];
    if (!primeraFila.cliente_id || !primeraFila.nombre) {
      return res.status(400).json({
        success: false,
        error: 'El archivo debe tener las columnas: cliente_id, nombre'
      });
    }
    
    // Procesar y cargar a Google Sheets
    if (SPREADSHEET_ID) {
      console.log('📊 [Upload] Cargando clientes a Google Sheets...');
      
      // Limpiar hoja de clientes
      await sheets.spreadsheets.values.clear({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Clientes!A:Z'
      });
      
      // Preparar datos para Google Sheets
      const headers = Object.keys(primeraFila);
      const values = [headers, ...data.map(row => headers.map(header => row[header] || ''))];
      
      // Insertar datos
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Clientes!A1',
        valueInputOption: 'RAW',
        requestBody: { values }
      });
      
      console.log(`✅ [Upload] ${data.length} clientes cargados a Google Sheets`);
    }
    
    res.json({
      success: true,
      message: `${data.length} clientes cargados exitosamente`,
      clientes_procesados: data.length
    });
    
  } catch (error) {
    console.error('❌ [Upload] Error procesando clientes:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint para cargar productos desde XLSX
app.post('/api/upload-productos-xlsx', upload.single('file'), async (req, res) => {
  try {
    console.log('📤 [Upload] Procesando archivo de productos...');
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No se recibió ningún archivo'
      });
    }
    
    console.log('📁 [Upload] Archivo recibido:', req.file.originalname);
    
    // Leer archivo XLSX
    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    console.log(`📊 [Upload] ${data.length} filas procesadas del XLSX`);
    
    if (data.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'El archivo está vacío o no tiene datos válidos'
      });
    }
    
    // Validar estructura mínima
    const primeraFila = data[0];
    if (!primeraFila.producto_id || !primeraFila.producto_nombre) {
      return res.status(400).json({
        success: false,
        error: 'El archivo debe tener las columnas: producto_id, producto_nombre'
      });
    }
    
    // Procesar y cargar a Google Sheets
    if (SPREADSHEET_ID) {
      console.log('📊 [Upload] Cargando productos a Google Sheets...');
      
      // Limpiar hoja de productos
      await sheets.spreadsheets.values.clear({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Productos!A:Z'
      });
      
      // Preparar datos para Google Sheets
      const headers = Object.keys(primeraFila);
      const values = [headers, ...data.map(row => headers.map(header => row[header] || ''))];
      
      // Insertar datos
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Productos!A1',
        valueInputOption: 'RAW',
        requestBody: { values }
      });
      
      console.log(`✅ [Upload] ${data.length} productos cargados a Google Sheets`);
    }
    
    res.json({
      success: true,
      message: `${data.length} productos cargados exitosamente`,
      productos_procesados: data.length
    });
    
  } catch (error) {
    console.error('❌ [Upload] Error procesando productos:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint para configurar webhook automáticamente
app.post('/api/setup-webhook', async (req, res) => {
  try {
    console.log('🔧 [Setup] Configurando webhook de Telegram...');
    
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      return res.status(400).json({
        success: false,
        error: 'TELEGRAM_BOT_TOKEN no configurado'
      });
    }
    
    // Determinar URL del webhook
    const baseUrl = process.env.RAILWAY_STATIC_URL || 
                   process.env.VERCEL_URL || 
                   `http://localhost:${PORT}`;
    
    const webhookUrl = `${baseUrl}/webhook`;
    
    console.log(`🔗 [Setup] URL del webhook: ${webhookUrl}`);
    
    // Configurar webhook
    const apiUrl = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
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
      console.log('✅ [Setup] Webhook configurado exitosamente');
      res.json({
        success: true,
        message: 'Webhook configurado exitosamente',
        webhook_url: webhookUrl
      });
    } else {
      console.error('❌ [Setup] Error configurando webhook:', result.description);
      res.status(500).json({
        success: false,
        error: result.description
      });
    }
    
  } catch (error) {
    console.error('❌ [Setup] Error en setup-webhook:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Ruta principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html', 'index.html'));
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
  console.log(`🌐 Dashboard: http://localhost:${PORT}`);
  console.log(`🤖 Bot de Telegram: ${process.env.TELEGRAM_BOT_TOKEN ? 'Configurado' : 'No configurado'}`);
  console.log(`📊 Google Sheets: ${SPREADSHEET_ID ? 'Configurado' : 'No configurado'}`);
  
  // Configurar webhook automáticamente si estamos en producción
  if (process.env.NODE_ENV === 'production' && process.env.RAILWAY_STATIC_URL) {
    console.log('🔧 Configurando webhook automáticamente...');
    fetch(`http://localhost:${PORT}/api/setup-webhook`, { method: 'POST' })
      .then(() => console.log('✅ Webhook configurado automáticamente'))
      .catch(error => console.log('⚠️ Error configurando webhook automático:', error.message));
  }
});

// Manejo de errores
process.on('uncaughtException', (error) => {
  console.error('❌ Error no capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promesa rechazada no manejada:', reason);
});