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
          obj[nombreColumna] = normalizarNumero(celda);
        } else {
          // Para columnas no numéricas, mantener el valor original
          // pero convertir null/undefined a string vacío
          if (celda === null || celda === undefined) {
            obj[nombreColumna] = '';
          } else {
            obj[nombreColumna] = celda;
          }
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
      return convertirANumeroOCero(valor);
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
      
      const metrica = metricas.get(