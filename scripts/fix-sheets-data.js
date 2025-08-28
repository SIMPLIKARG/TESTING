#!/usr/bin/env node

/**
 * Script para poblar Google Sheets con datos de ejemplo
 * Ejecutar con: node scripts/fix-sheets-data.js
 */

const { GoogleAuth } = require('google-auth-library');
const { google } = require('googleapis');
require('dotenv').config();

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;

const auth = new GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

// Datos de productos de ejemplo (estructura similar a tu CSV)
const productosEjemplo = [
  ['producto_id', 'categoria_id', 'producto_nombre', 'precio1', 'precio2', 'precio3', 'precio4', 'precio5', 'activo'],
  
  // Galletitas
  [1, 1, 'Oreo Original 117g', 450, 420, 400, 380, 360, 'SI'],
  [2, 1, 'Pepitos Chocolate 100g', 380, 360, 340, 320, 300, 'SI'],
  [3, 1, 'Tita Vainilla 168g', 320, 300, 280, 260, 240, 'SI'],
  [4, 1, 'Chocolinas 170g', 290, 270, 250, 230, 210, 'SI'],
  [5, 1, 'Criollitas Dulces 200g', 350, 330, 310, 290, 270, 'SI'],
  
  // Bebidas
  [6, 2, 'Coca Cola 500ml', 350, 330, 310, 290, 270, 'SI'],
  [7, 2, 'Agua Mineral 500ml', 180, 170, 160, 150, 140, 'SI'],
  [8, 2, 'Jugo Naranja 1L', 420, 400, 380, 360, 340, 'SI'],
  [9, 2, 'Sprite 500ml', 340, 320, 300, 280, 260, 'SI'],
  [10, 2, 'Fanta 500ml', 340, 320, 300, 280, 260, 'SI'],
  
  // Lácteos
  [11, 3, 'Leche Entera 1L', 280, 260, 240, 220, 200, 'SI'],
  [12, 3, 'Yogur Natural 125g', 150, 140, 130, 120, 110, 'SI'],
  [13, 3, 'Queso Cremoso 200g', 520, 490, 460, 430, 400, 'SI'],
  [14, 3, 'Manteca 200g', 380, 360, 340, 320, 300, 'SI'],
  [15, 3, 'Dulce de Leche 400g', 450, 420, 390, 360, 330, 'SI'],
  
  // Panadería
  [16, 4, 'Pan Lactal 500g', 320, 300, 280, 260, 240, 'SI'],
  [17, 4, 'Medialunas x6', 450, 420, 390, 360, 330, 'SI'],
  [18, 4, 'Pan Hamburguesa x4', 380, 360, 340, 320, 300, 'SI'],
  [19, 4, 'Tostadas x20', 280, 260, 240, 220, 200, 'SI'],
  [20, 4, 'Facturas Surtidas x6', 520, 490, 460, 430, 400, 'SI'],
  
  // Conservas
  [21, 5, 'Atún en Aceite 170g', 420, 400, 380, 360, 340, 'SI'],
  [22, 5, 'Tomate Triturado 400g', 280, 260, 240, 220, 200, 'SI'],
  [23, 5, 'Arvejas en Lata 300g', 250, 230, 210, 190, 170, 'SI'],
  [24, 5, 'Choclo en Lata 300g', 270, 250, 230, 210, 190, 'SI'],
  [25, 5, 'Mermelada Durazno 450g', 380, 360, 340, 320, 300, 'SI'],
  
  // Snacks
  [26, 6, 'Papas Fritas 150g', 320, 300, 280, 260, 240, 'SI'],
  [27, 6, 'Palitos Salados 100g', 180, 170, 160, 150, 140, 'SI'],
  [28, 6, 'Maní Salado 200g', 250, 230, 210, 190, 170, 'SI'],
  [29, 6, 'Chizitos 75g', 220, 200, 180, 160, 140, 'SI'],
  
  // Dulces
  [30, 7, 'Alfajor Havanna', 180, 170, 160, 150, 140, 'SI'],
  [31, 7, 'Chocolate Milka 100g', 450, 420, 390, 360, 330, 'SI'],
  [32, 7, 'Caramelos Sugus x10', 120, 110, 100, 90, 80, 'SI'],
  [33, 7, 'Chicles Beldent x5', 80, 75, 70, 65, 60, 'SI'],
  
  // Limpieza
  [34, 8, 'Detergente 500ml', 320, 300, 280, 260, 240, 'SI'],
  [35, 8, 'Lavandina 1L', 180, 170, 160, 150, 140, 'SI'],
  [36, 8, 'Esponja Cocina x3', 150, 140, 130, 120, 110, 'SI'],
  [37, 8, 'Papel Higiénico x4', 280, 260, 240, 220, 200, 'SI'],
  
  // Higiene Personal
  [38, 9, 'Shampoo 400ml', 450, 420, 390, 360, 330, 'SI'],
  [39, 9, 'Jabón Tocador x3', 220, 200, 180, 160, 140, 'SI'],
  [40, 9, 'Pasta Dental 90g', 180, 170, 160, 150, 140, 'SI'],
  
  // Congelados
  [41, 10, 'Hamburguesas x4', 520, 490, 460, 430, 400, 'SI'],
  [42, 10, 'Papas Congeladas 1kg', 380, 360, 340, 320, 300, 'SI'],
  [43, 10, 'Helado 1L', 650, 620, 590, 560, 530, 'SI']
];

async function poblarProductos() {
  try {
    console.log('🔧 Arreglando datos de productos en Google Sheets...');
    
    if (!SPREADSHEET_ID) {
      throw new Error('GOOGLE_SHEETS_ID no está configurado');
    }
    
    // Verificar conexión
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID
    });
    
    console.log(`✅ Conectado a: "${spreadsheet.data.properties?.title}"`);
    
    // Limpiar hoja de Productos
    console.log('🧹 Limpiando hoja de Productos...');
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Productos!A:Z'
    });
    
    // Insertar datos de productos
    console.log(`📦 Insertando ${productosEjemplo.length - 1} productos...`);
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Productos!A1',
      valueInputOption: 'RAW',
      requestBody: {
        values: productosEjemplo
      }
    });
    
    console.log('🎉 ¡Productos cargados exitosamente!');
    console.log('');
    console.log('📊 PRODUCTOS CARGADOS:');
    console.log('   🍪 Galletitas: 5 productos');
    console.log('   🥤 Bebidas: 5 productos');
    console.log('   🥛 Lácteos: 5 productos');
    console.log('   🍞 Panadería: 5 productos');
    console.log('   🥫 Conservas: 5 productos');
    console.log('   🍿 Snacks: 4 productos');
    console.log('   🍬 Dulces: 4 productos');
    console.log('   🧽 Limpieza: 4 productos');
    console.log('   🧴 Higiene: 3 productos');
    console.log('   🧊 Congelados: 3 productos');
    console.log('');
    console.log(`🔗 Ver hoja: https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  poblarProductos();
}

module.exports = { poblarProductos };