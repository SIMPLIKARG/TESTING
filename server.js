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

// Estado del usuario (en memoria)
const userStates = new Map();
const userCarts = new Map();

// Datos de ejemplo
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
    { producto_id: 1, categoria_id: 1, producto_nombre: 'Oreo Original 117g', precio: 450, activo: 'SI' },
    { producto_id: 2, categoria_id: 1, producto_nombre: 'Pepitos Chocolate 100g', precio: 380, activo: 'SI' },
    { producto_id: 3, categoria_id: 2, producto_nombre: 'Coca Cola 500ml', precio: 350, activo: 'SI' },
    { producto_id: 4, categoria_id: 3, producto_nombre: 'Leche Entera 1L', precio: 280, activo: 'SI' },
    { producto_id: 5, categoria_id: 4, producto_nombre: 'Pan Lactal 500g', precio: 320, activo: 'SI' }
  ],
  detallepedidos: [
    { detalle_id: 'DET001', pedido_id: 'PED001', producto_id: 1, producto_nombre: 'Oreo Original 117g', categoria_id: 1, cantidad: 2, precio_unitario: 450, importe: 900 },
    { detalle_id: 'DET002', pedido_id: 'PED001', producto_id: 4, producto_nombre: 'Leche Entera 1L', categoria_id: 3, cantidad: 1, precio_unitario: 280, importe: 280 },
    { detalle_id: 'DET003', pedido_id: 'PED002', producto_id: 3, producto_nombre: 'Coca Cola 500ml', categoria_id: 2, cantidad: 2, precio_unitario: 350, importe: 700 }
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

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${nombreHoja}!A:Z`,
      valueInputOption: 'USER_ENTERED',
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

// Función para generar ID de pedido
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

// Comandos del bot
bot.on('callback_query', async (ctx) => {
  const userId = ctx.from.id;
  const callbackData = ctx.callbackQuery.data;
  
  try {
    await ctx.answerCbQuery();
    
    if (callbackData === 'hacer_pedido') {
      const clientes = await obtenerDatosSheet('Clientes');
      
      if (clientes.length === 0) {
        await ctx.reply('❌ No hay clientes disponibles');
        return;
      }
      
      setUserState(userId, { step: 'seleccionar_cliente' });
      
      const keyboard = clientes.map(cliente => [{
        text: `👤 ${cliente.nombre}`,
        callback_data: `cliente_${cliente.cliente_id}`
      }]);
      
      await ctx.reply('👤 Selecciona el cliente:', {
        reply_markup: { inline_keyboard: keyboard }
      });
      
    } else if (callbackData.startsWith('cliente_')) {
      const clienteId = parseInt(callbackData.split('_')[1]);
      
      const clientes = await obtenerDatosSheet('Clientes');
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
      
      const categorias = await obtenerDatosSheet('Categorias');
      
      const keyboard = categorias.map(cat => [{
        text: `📂 ${cat.categoria_nombre}`,
        callback_data: `categoria_${cat.categoria_id}`
      }]);
      
      await ctx.editMessageText(`✅ Cliente: ${cliente.nombre}\n\n📂 Selecciona una categoría:`, {
        reply_markup: { inline_keyboard: keyboard }
      });
    }
    
  } catch (error) {
    console.error('❌ Error en callback:', error);
    await ctx.reply('❌ Ocurrió un error. Intenta nuevamente.');
  }
});

// Configurar webhook
app.post('/webhook', (req, res) => {
  try {
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
      'Sistema de pedidos'
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