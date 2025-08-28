import express from 'express';
import cors from 'cors';
import { Telegraf } from 'telegraf';
import { GoogleAuth } from 'google-auth-library';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
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

// Función para normalizar números (convertir comas a puntos y limpiar formato)
function normalizarNumero(valor) {
  if (valor === '' || valor === null || valor === undefined || valor === 'null' || valor === 'undefined') {
    return 0;
  }
  
  // Convertir a string para procesamiento
  let valorStr = String(valor).trim();
  
  // Si ya es un número válido, devolverlo
  if (!isNaN(valorStr) && !isNaN(parseFloat(valorStr))) {
    return parseFloat(valorStr);
  }
  
  // Limpiar el formato de números:
  // - Remover espacios
  // - Reemplazar comas por puntos (formato decimal argentino -> estadounidense)
  // - Remover caracteres no numéricos excepto puntos y signos negativos
  valorStr = valorStr
    .replace(/\s/g, '') // Remover espacios
    .replace(/,/g, '.') // Reemplazar comas por puntos
    .replace(/[^\d.-]/g, ''); // Mantener solo dígitos, puntos y signos negativos
  
  // Convertir a número
  const numero = parseFloat(valorStr);
  
  // Si no es un número válido, devolver 0
  return isNaN(numero) ? 0 : numero;
}

// Definir qué columnas deben ser numéricas para cada hoja
const columnasNumericas = {
  Clientes: ['cliente_id', 'lista'],
  Categorias: ['categoria_id'],
  Productos: ['producto_id', 'categoria_id', 'precio1', 'precio2', 'precio3', 'precio4', 'precio5', 'proveedor_id'],
  Pedidos: ['cliente_id', 'items_cantidad', 'total'],
  DetallePedidos: ['producto_id', 'categoria_id', 'cantidad', 'precio_unitario', 'importe'],
  Metricas: ['producto_id', 'categoria_id', 'proveedor_id', 'cantidad_vendida', 'ingresos_totales', 'costo_total_estimado', 'ganancia_total_estimada', 'rentabilidad_porcentual']
};

// Función para convertir valores a números, tratando vacíos como 0
function convertirANumeroOCero(valor) {
  // Si está vacío, null, undefined o es string vacío
  if (valor === '' || valor === null || valor === undefined || valor === 'null' || valor === 'undefined') {
    return 0;
  }
  
  // Si ya es un número
  if (typeof valor === 'number') {
    return isNaN(valor) || !isFinite(valor) ? 0 : valor;
  }
  
  // Intentar convertir a número
  const numero = Number(valor);
  return isNaN(numero) || !isFinite(numero) ? 0 : numero;
}

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
    { producto_id: 1, categoria_id: 1, producto_nombre: 'Oreo Original 117g', precio1: 450, precio2: 420, precio3: 400, precio4: 380, precio5: 360, activo: 'SI', proveedor_id: 'PROV001', proveedor_nombre: 'Mondelez Argentina' },
    { producto_id: 2, categoria_id: 1, producto_nombre: 'Pepitos Chocolate 100g', precio1: 380, precio2: 360, precio3: 340, precio4: 320, precio5: 300, activo: 'SI', proveedor_id: 'PROV002', proveedor_nombre: 'Arcor S.A.' },
    { producto_id: 3, categoria_id: 2, producto_nombre: 'Coca Cola 500ml', precio1: 350, precio2: 330, precio3: 310, precio4: 290, precio5: 270, activo: 'SI', proveedor_id: 'PROV003', proveedor_nombre: 'Coca-Cola FEMSA' },
    { producto_id: 4, categoria_id: 3, producto_nombre: 'Leche Entera 1L', precio1: 280, precio2: 260, precio3: 240, precio4: 220, precio5: 200, activo: 'SI', proveedor_id: 'PROV004', proveedor_nombre: 'La Serenísima' },
    { producto_id: 5, categoria_id: 4, producto_nombre: 'Pan Lactal 500g', precio1: 320, precio2: 300, precio3: 280, precio4: 260, precio5: 240, activo: 'SI', proveedor_id: 'PROV005', proveedor_nombre: 'Bimbo Argentina' }
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

// Función para procesar datos de Google Sheets con tipos correctos
function procesarDatosSheet(rows, nombreHoja) {
  if (!rows || rows.length === 0) return [];
  
  const headers = rows[0];
  const columnasNum = columnasNumericas[nombreHoja] || [];
  
  return rows.slice(1)
    .filter(row => row && row.length > 0 && row[0] && row[0].toString().trim())
    .map(row => {
      const obj = {};
      
      headers.forEach((nombreColumna, index) => {
        const celda = row[index] ? row[index].toString().trim() : '';
        
        // Si esta columna debe ser numérica
        if (columnasNum.includes(nombreColumna)) {
          return normalizarNumero(celda);
        }
        
        // Para columnas no numéricas, mantener el valor original
        // pero convertir null/undefined a string vacío
        if (celda === null || celda === undefined) {
          return '';
        }
        
        return celda;
      });
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
}

// Función para obtener datos de Google Sheets
async function obtenerDatosSheet(nombreHoja) {
  try {
    if (!SPREADSHEET_ID) {
      console.log(`⚠️ Google Sheets no configurado, usando datos de ejemplo`);
      return datosEjemplo[nombreHoja.toLowerCase()] || [];
    }

    console.log(`📊 Obteniendo ${nombreHoja}...`);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${nombreHoja}!A:Z`,
    });

    const rows = response.data.values || [];
    console.log(`📋 ${nombreHoja}: ${rows.length} filas`);
    
    if (rows.length === 0) return [];

    const headers = rows[0];
    console.log(`📋 Encabezados:`, headers);
    
    // Obtener las columnas numéricas para esta hoja
    const columnasNum = columnasNumericas[nombreHoja] || [];
    
    // Filtrar filas vacías y mapear datos
    const data = rows.slice(1)
      .filter(row => row && row.length > 0 && row[0] && row[0].toString().trim()) // Filtrar filas vacías
      .map(row => {
      const obj = {};
      headers.forEach((header, index) => {
        const valor = row[index] ? row[index].toString().trim() : '';
        
        // Si esta columna debe ser numérica, convertir a número (vacíos = 0)
        if (columnasNum.includes(header)) {
          obj[header] = convertirANumeroOCero(valor);
        } else {
          // Para columnas de texto, mantener como string
          obj[header] = valor;
        }
        // Convertir a número si es posible, sino mantener como string
        obj[header] = convertirANumero(value);
        
        // Convertir números específicos según el tipo de hoja
        if (nombreHoja === 'Productos') {
          if (['producto_id', 'categoria_id'].includes(header)) {
            obj[header] = convertirANumero(valor);
          } else if (header.startsWith('precio') || header === 'costo') {
            obj[header] = convertirANumero(valor);
          } else {
            obj[header] = valor;
          }
        } else if (nombreHoja === 'Clientes') {
          if (['cliente_id', 'lista'].includes(header)) {
            obj[header] = convertirANumero(valor);
          } else {
            obj[header] = valor;
          }
        } else {
          obj[header] = valor;
        }
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

    console.log(`✅ ${nombreHoja}: ${data.length} registros válidos`);
    return data;
  } catch (error) {
    console.error(`❌ Error ${nombreHoja}:`, error.message);
    return datosEjemplo[nombreHoja.toLowerCase()] || [];
  }
}

// Función para agregar datos a Google Sheets
async function agregarDatosSheet(nombreHoja, datos) {
  try {
    if (!SPREADSHEET_ID) {
      console.log(`⚠️ Google Sheets no configurado, simulando inserción en ${nombreHoja}`);
      return true;
    }

    // Procesar datos para convertir números correctamente
    const datosProcessados = datos.map(valor => {
      return convertirANumero(valor);
    });
    // Convertir datos numéricos correctamente
    const datosFormateados = datos.map(valor => {
      // Si es un número válido, convertirlo a número
      if (typeof valor === 'string' && !isNaN(valor) && valor.trim() !== '') {
        const numero = parseFloat(valor);
        return isNaN(numero) ? valor : numero;
      }
      return valor;
    });

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${nombreHoja}!A:Z`,
     valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [datosProcessados]
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

// Función para actualizar métricas en Google Sheets
async function actualizarMetricasEnSheets() {
  try {
    console.log('📊 Iniciando actualización de métricas...');
    
    if (!SPREADSHEET_ID) {
      console.log('⚠️ Google Sheets no configurado, no se pueden actualizar métricas');
      return false;
    }
    
    // Obtener todos los datos necesarios
    console.log('📋 Obteniendo datos de las hojas...');
    const [pedidos, detalles, productos, categorias] = await Promise.all([
      obtenerDatosSheet('Pedidos'),
      obtenerDatosSheet('DetallePedidos'),
      obtenerDatosSheet('Productos'),
      obtenerDatosSheet('Categorias')
    ]);
    
    console.log(`📊 Datos obtenidos: ${pedidos.length} pedidos, ${detalles.length} detalles, ${productos.length} productos`);
    
    // Filtrar solo pedidos confirmados
    const pedidosConfirmados = pedidos.filter(pedido => 
      pedido.estado && pedido.estado.toUpperCase() === 'CONFIRMADO'
    );
    
    console.log(`✅ Pedidos confirmados: ${pedidosConfirmados.length}`);
    
    // Obtener IDs de pedidos confirmados
    const pedidosConfirmadosIds = new Set(pedidosConfirmados.map(p => p.pedido_id));
    
    // Filtrar detalles solo de pedidos confirmados
    const detallesConfirmados = detalles.filter(detalle => 
      pedidosConfirmadosIds.has(detalle.pedido_id)
    );
    
    console.log(`📋 Detalles de pedidos confirmados: ${detallesConfirmados.length}`);
    
    // Crear mapas para búsqueda rápida
    const productosMap = new Map();
    productos.forEach(producto => {
      productosMap.set(producto.producto_id.toString(), producto);
    });
    
    const categoriasMap = new Map();
    categorias.forEach(categoria => {
      categoriasMap.set(categoria.categoria_id.toString(), categoria);
    });
    
    // Procesar métricas por producto
    const metricas = new Map();
    
    detallesConfirmados.forEach(detalle => {
      const productoId = detalle.producto_id.toString();
      const cantidad = parseInt(detalle.cantidad) || 0;
      const importe = parseFloat(detalle.importe) || 0;
      
      if (!metricas.has(productoId)) {
        const producto = productosMap.get(productoId);
        const categoria = producto ? categoriasMap.get(producto.categoria_id.toString()) : null;
        
        metricas.set(productoId, {
          producto_id: productoId,
          producto_nombre: detalle.producto_nombre || (producto ? producto.producto_nombre : 'Producto Desconocido'),
          categoria_id: producto ? producto.categoria_id : '',
          categoria_nombre: categoria ? categoria.categoria_nombre : 'Sin Categoría',
          proveedor_id: producto ? (producto.proveedor_id || 'SIN_PROV') : 'SIN_PROV',
          proveedor_nombre: producto ? (producto.proveedor_nombre || 'Sin Proveedor') : 'Sin Proveedor',
          cantidad_vendida: 0,
          ingresos_totales: 0,
          costo_total_estimado: 0,
          ganancia_total_estimada: 0,
          rentabilidad_porcentual: 0
        });
      }
      
      const metrica = metricas.get(productoId);
      metrica.cantidad_vendida += cantidad;
      metrica.ingresos_totales += importe;
    });
    
    // Calcular costos, ganancias y rentabilidad
    metricas.forEach(metrica => {
      // Costo estimado: 60% del precio de venta
      metrica.costo_total_estimado = metrica.ingresos_totales * 0.6;
      metrica.ganancia_total_estimada = metrica.ingresos_totales - metrica.costo_total_estimado;
      
      // Rentabilidad porcentual
      if (metrica.ingresos_totales > 0) {
        metrica.rentabilidad_porcentual = (metrica.ganancia_total_estimada / metrica.ingresos_totales) * 100;
      }
      
      // Redondear valores
      metrica.costo_total_estimado = Math.round(metrica.costo_total_estimado * 100) / 100;
      metrica.ganancia_total_estimada = Math.round(metrica.ganancia_total_estimada * 100) / 100;
      metrica.rentabilidad_porcentual = Math.round(metrica.rentabilidad_porcentual * 100) / 100;
    });
    
    console.log(`📊 Métricas calculadas para ${metricas.size} productos`);
    
    // Preparar datos para Google Sheets
    const encabezados = [
      'producto_id', 'producto_nombre', 'categoria_id', 'categoria_nombre',
      'proveedor_id', 'proveedor_nombre', 'cantidad_vendida', 'ingresos_totales',
      'costo_total_estimado', 'ganancia_total_estimada', 'rentabilidad_porcentual'
    ];
    
    const datosParaSheets = [encabezados];
    
    // Convertir métricas a array y ordenar por ingresos totales (descendente)
    const metricasArray = Array.from(metricas.values()).sort((a, b) => b.ingresos_totales - a.ingresos_totales);
    
    metricasArray.forEach(metrica => {
      datosParaSheets.push([
        parseInt(metrica.producto_id),
        metrica.producto_nombre,
        parseInt(metrica.categoria_id),
        metrica.categoria_nombre,
        metrica.proveedor_id,
        metrica.proveedor_nombre,
        parseInt(metrica.cantidad_vendida),
        parseFloat((metrica.ingresos_totales).toFixed(2)),
        parseFloat((metrica.costo_total_estimado).toFixed(2)),
        parseFloat((metrica.ganancia_total_estimada).toFixed(2)),
        parseFloat((metrica.rentabilidad_porcentual).toFixed(2))
      ]);
    });
    
    // Limpiar hoja de métricas
    console.log('🧹 Limpiando hoja de Metricas...');
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Metricas!A:Z'
    });
    
    // Escribir nuevos datos
    console.log('✍️ Escribiendo métricas actualizadas...');
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Metricas!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: datosParaSheets
      }
    });
    
    console.log(`✅ Métricas actualizadas exitosamente: ${metricasArray.length} productos procesados`);
    return true;
    
  } catch (error) {
    console.error('❌ Error actualizando métricas:', error);
    return false;
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
      
      // Agregar botón de eliminar para cada producto (máximo 5 por fila)
      if (cart.length <= 10) { // Solo mostrar botones individuales si hay pocos productos
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
      
    } else if (callbackData === 'buscar_cliente') {
      setUserState(userId, { ...getUserState(userId), step: 'buscar_cliente' });
      await ctx.reply('🔍 Escribe el nombre del cliente que buscas:');
      
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
      
    } else if (userState.step === 'buscar_producto') {
      const termino = text.toLowerCase().trim();
      
      if (termino.length < 2) {
        await ctx.reply('❌ Escribe al menos 2 caracteres para buscar');
        return;
      }
      
      const productos = await obtenerDatosSheet('Productos');
      const categoriaId = userState.categoria_busqueda;
      
      const productosFiltrados = productos.filter(producto => {
        const nombre = (producto.producto_nombre || '').toLowerCase();
        const enCategoria = !categoriaId || producto.categoria_id == categoriaId;
        const activo = producto.activo === 'SI';
        return nombre.includes(termino) && enCategoria && activo;
      });
      
      if (productosFiltrados.length === 0) {
        await ctx.reply(`❌ No se encontraron productos con "${text}"`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔍 Buscar de nuevo', callback_data: `buscar_producto_${categoriaId}` }],
              [{ text: '📂 Ver categoría', callback_data: `categoria_${categoriaId}` }]
            ]
          }
        });
        return;
      }
      
      const keyboard = productosFiltrados.map(producto => [{
        text: `🛍️ ${producto.producto_nombre}`,
        callback_data: `producto_${producto.producto_id}`
      }]);
      keyboard.push([{ text: '📂 Ver categoría', callback_data: `categoria_${categoriaId}` }]);
      const botonesBusquedaExitosa = categoriaId ? [
        [{ text: '🔍 Buscar de nuevo', callback_data: `buscar_producto_${categoriaId}` }],
        [{ text: '📂 Ver categoría', callback_data: `categoria_${categoriaId}` }]
      ] : [
        [{ text: '🔍 Buscar de nuevo', callback_data: 'buscar_producto_general' }],
        [{ text: '📂 Ver categorías', callback_data: 'seguir_comprando' }]
      ];
      
      keyboard.push(...botonesBusquedaExitosa);
      
      await ctx.reply(`🔍 Encontrados ${productosFiltrados.length} producto(s):`, {
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
    
    // Crear pedido en Google Sheets
    const fechaHora = new Date().toISOString();
    
    const pedidoData = [
      pedidoId,
      fechaHora,
      convertirANumeroOCero(cliente.cliente_id),
      cliente.nombre,
      convertirANumeroOCero(itemsTotal),
      convertirANumeroOCero(montoTotal),
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
        convertirANumeroOCero(item.producto_id),
        item.producto_nombre,
        convertirANumeroOCero(item.categoria_id),
        convertirANumeroOCero(item.cantidad),
        convertirANumeroOCero(item.precio_unitario),
        convertirANumeroOCero(item.importe)
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
    
    // Obtener datos de ambas hojas
    const pedidos = await obtenerDatosSheet('Pedidos');
    const detalles = await obtenerDatosSheet('DetallePedidos');
    
    console.log(`📋 Pedidos: ${pedidos.length}, Detalles: ${detalles.length}`);
    
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
    
    // Validar estados permitidos
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

// Endpoint para obtener métricas
app.get('/api/metricas', async (req, res) => {
  try {
    console.log('📊 Obteniendo métricas...');
    const metricas = await obtenerDatosSheet('Metricas');
    
    // Convertir strings a números donde sea necesario
    const metricasProcesadas = metricas.map(metrica => ({
      ...metrica,
      cantidad_vendida: parseInt(metrica.cantidad_vendida) || 0,
      ingresos_totales: parseFloat(metrica.ingresos_totales) || 0,
      costo_total_estimado: parseFloat(metrica.costo_total_estimado) || 0,
      ganancia_total_estimada: parseFloat(metrica.ganancia_total_estimada) || 0,
      rentabilidad_porcentual: parseFloat(metrica.rentabilidad_porcentual) || 0
    }));
    
    console.log(`✅ Métricas obtenidas: ${metricasProcesadas.length} productos`);
    
    res.json({ 
      success: true, 
      metricas: metricasProcesadas,
      total_productos: metricasProcesadas.length
    });
    
  } catch (error) {
    console.error('❌ Error obteniendo métricas:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint para actualizar métricas
app.post('/api/actualizar-metricas', async (req, res) => {
  try {
    console.log('🔄 Solicitud de actualización de métricas recibida');
    
    const resultado = await actualizarMetricasEnSheets();
    
    if (resultado) {
      res.json({ 
        success: true, 
        message: 'Métricas actualizadas exitosamente',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: 'No se pudieron actualizar las métricas' 
      });
    }
    
  } catch (error) {
    console.error('❌ Error en actualización de métricas:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Endpoint para obtener resumen de métricas por categoría
app.get('/api/metricas-por-categoria', async (req, res) => {
  try {
    console.log('📊 Obteniendo métricas por categoría...');
    const metricas = await obtenerDatosSheet('Metricas');
    
    // Agrupar por categoría
    const metricasPorCategoria = {};
    
    metricas.forEach(metrica => {
      const categoriaId = metrica.categoria_id;
      const categoriaNombre = metrica.categoria_nombre || 'Sin Categoría';
      
      if (!metricasPorCategoria[categoriaId]) {
        metricasPorCategoria[categoriaId] = {
          categoria_id: categoriaId,
          categoria_nombre: categoriaNombre,
          total_productos: 0,
          cantidad_total_vendida: 0,
          ingresos_totales: 0,
          ganancia_total: 0,
          rentabilidad_promedio: 0
        };
      }
      
      const categoria = metricasPorCategoria[categoriaId];
      categoria.total_productos += 1;
      categoria.cantidad_total_vendida += parseInt(metrica.cantidad_vendida) || 0;
      categoria.ingresos_totales += parseFloat(metrica.ingresos_totales) || 0;
      categoria.ganancia_total += parseFloat(metrica.ganancia_total_estimada) || 0;
    });
    
    // Calcular rentabilidad promedio por categoría
    Object.values(metricasPorCategoria).forEach(categoria => {
      if (categoria.ingresos_totales > 0) {
        categoria.rentabilidad_promedio = (categoria.ganancia_total / categoria.ingresos_totales) * 100;
        categoria.rentabilidad_promedio = Math.round(categoria.rentabilidad_promedio * 100) / 100;
      }
    });
    
    // Convertir a array y ordenar por ingresos
    const categoriasArray = Object.values(metricasPorCategoria)
      .sort((a, b) => b.ingresos_totales - a.ingresos_totales);
    
    console.log(`✅ Métricas por categoría: ${categoriasArray.length} categorías`);
    
    res.json({ 
      success: true, 
      categorias: categoriasArray,
      total_categorias: categoriasArray.length
    });
    
  } catch (error) {
    console.error('❌ Error obteniendo métricas por categoría:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint para cargar CSV de clientes
app.post('/api/upload-clientes-csv', async (req, res) => {
  try {
    const { csvContent, fileName } = req.body;
    
    console.log(`📤 Procesando carga de CSV: ${fileName}`);
    
    if (!csvContent) {
      return res.status(400).json({
        success: false,
        error: 'No se proporcionó contenido CSV'
      });
    }
    
    if (!SPREADSHEET_ID) {
      console.log(`⚠️ Google Sheets no configurado, simulando carga de CSV`);
      return res.json({
        success: true,
        message: 'CSV procesado (simulado)',
        recordsProcessed: 'N/A'
      });
    }
    
    // Parsear el contenido CSV usando csv-parse
    console.log('📋 Parseando contenido CSV con csv-parse...');
    
    let csvData;
    try {
      csvData = parse(csvContent, {
        skip_empty_lines: true,
        trim: true,
        relax_quotes: true,
        relax_column_count: true
      });
    } catch (parseError) {
      return res.status(400).json({
        success: false,
        error: `Error parseando CSV: ${parseError.message}`
      });
    }
    
    if (csvData.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'El archivo CSV está vacío'
      });
    }
    
    console.log(`📊 CSV parseado: ${csvData.length} filas, ${csvData[0]?.length || 0} columnas`);
    
    // Limpiar la hoja "Clientes" primero
    console.log('🧹 Limpiando hoja Clientes...');
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Clientes!A:Z'
    });
    
    // Escribir los nuevos datos usando USER_ENTERED para formateo automático
    console.log('✍️ Escribiendo nuevos datos en Clientes...');
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Clientes!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: csvData
      }
    });
    
    console.log(`✅ CSV cargado exitosamente: ${csvData.length} registros`);
    
    res.json({
      success: true,
      message: 'Base de clientes actualizada exitosamente',
      recordsProcessed: csvData.length,
      fileName: fileName
    });
    
  } catch (error) {
    console.error('❌ Error cargando CSV:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint para cargar CSV de productos
app.post('/api/upload-productos-csv', async (req, res) => {
  try {
    const { csvContent, fileName } = req.body;
    
    console.log(`📦 Procesando carga de CSV de productos: ${fileName}`);
    
    if (!csvContent) {
      return res.status(400).json({
        success: false,
        error: 'No se proporcionó contenido CSV'
      });
    }
    
    if (!SPREADSHEET_ID) {
      console.log(`⚠️ Google Sheets no configurado, simulando carga de CSV de productos`);
      return res.json({
        success: true,
        message: 'CSV de productos procesado (simulado)',
        recordsProcessed: 'N/A'
      });
    }
    
    // Parsear el contenido CSV usando csv-parse
    console.log('📋 Parseando contenido CSV de productos con csv-parse...');
    
    let csvData;
    try {
      csvData = parse(csvContent, {
        skip_empty_lines: true,
        trim: true,
        relax_quotes: true,
        relax_column_count: true
      });
    } catch (parseError) {
      return res.status(400).json({
        success: false,
        error: `Error parseando CSV de productos: ${parseError.message}`
      });
    }
    
    if (csvData.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'El archivo CSV está vacío'
      });
    }
    
    console.log(`📊 CSV de productos parseado: ${csvData.length} filas, ${csvData[0]?.length || 0} columnas`);
    
    // Limpiar la hoja "Productos" primero
    console.log('🧹 Limpiando hoja Productos...');
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Productos!A:Z'
    });
    
    // Escribir los nuevos datos usando USER_ENTERED para formateo automático
    console.log('✍️ Escribiendo nuevos datos en Productos...');
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Productos!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: csvData
      }
    });
    
    console.log(`✅ CSV de productos cargado exitosamente: ${csvData.length} registros`);
    
    res.json({
      success: true,
      message: 'Base de productos actualizada exitosamente',
      recordsProcessed: csvData.length,
      fileName: fileName
    });
    
  } catch (error) {
    console.error('❌ Error cargando CSV de productos:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint para limpiar y recargar datos con formato correcto
app.post('/api/recargar-datos', async (req, res) => {
  try {
    console.log('🔄 Iniciando recarga completa de datos...');
    
    // Datos de ejemplo con tipos correctos
    const datosCorrectos = {
      Productos: [
        ['producto_id', 'categoria_id', 'producto_nombre', 'precio1', 'precio2', 'precio3', 'precio4', 'precio5', 'activo'],
        [445, 1, 'ACTRON 10U', 1721.69, 2499.9, 2437.40, 2708.22, 2291.57, 'SI'],
        [446, 1, 'ACTRON 600 X10U', 4603.78, 6684.69, 6517.57, 7241.75, 6127.63, 'SI'],
        [447, 1, 'ACTRON MUJER X10U', 2045.86, 2970.59, 2896.33, 3218.14, 2723.04, 'SI'],
        [448, 1, 'ACTRON PLUS 8U', 2439.76, 3542.53, 3453.97, 3837.74, 3247.32, 'SI'],
        [449, 1, 'AGUA OXIGENADA VOL10', 372.17, 540.39, 526.88, 585.42, 495.36, 'SI']
      ],
      Clientes: [
        ['cliente_id', 'nombre', 'lista'],
        [1, 'Juan Pérez', 1],
        [2, 'María González', 2],
        [3, 'Carlos Rodríguez', 1],
        [4, 'Ana Martínez', 3],
        [5, 'Luis Fernández', 2]
      ],
      Categorias: [
        ['categoria_id', 'categoria_nombre'],
        [1, 'Galletitas'],
        [2, 'Bebidas'],
        [3, 'Lácteos'],
        [4, 'Panadería'],
        [5, 'Conservas']
      ]
    };

    const resultados = {};
    
    // Recargar cada hoja
    for (const [nombreHoja, datos] of Object.entries(datosCorrectos)) {
      const exito = await limpiarYRecargarHoja(nombreHoja, datos);
      resultados[nombreHoja] = exito ? 'Exitoso' : 'Error';
    }

    console.log('✅ Recarga completa finalizada');
    
    res.json({
      success: true,
      message: 'Datos recargados con formato correcto',
      resultados: resultados
    });
    
  } catch (error) {
    console.error('❌ Error en recarga completa:', error);
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