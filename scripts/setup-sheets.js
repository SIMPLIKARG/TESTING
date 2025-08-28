#!/usr/bin/env node

/**
 * Script para configurar automáticamente las hojas de Google Sheets
 * Ejecutar con: node scripts/setup-sheets.js
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

// Datos de ejemplo para poblar las hojas
const datosEjemplo = {
  Clientes: [
    ['cliente_id', 'nombre'],
    [1, 'Juan Pérez'],
    [2, 'María González'],
    [3, 'Carlos Rodríguez'],
    [4, 'Ana Martínez'],
    [5, 'Luis Fernández'],
    [6, 'Carmen López'],
    [7, 'Roberto Silva'],
    [8, 'Elena Morales']
  ],
  
  Categorias: [
    ['categoria_id', 'categoria_nombre'],
    [1, 'Galletitas'],
    [2, 'Bebidas'],
    [3, 'Lácteos'],
    [4, 'Panadería'],
    [5, 'Conservas']
  ],
  
  Productos: [
    ['producto_id', 'categoria_id', 'producto_nombre', 'precio', 'activo'],
    [1, 1, 'Oreo Original 117g', 450, 'SI'],
    [2, 1, 'Pepitos Chocolate 100g', 380, 'SI'],
    [3, 1, 'Tita Vainilla 168g', 320, 'SI'],
    [4, 1, 'Chocolinas 170g', 290, 'SI'],
    [5, 2, 'Coca Cola 500ml', 350, 'SI'],
    [6, 2, 'Agua Mineral 500ml', 180, 'SI'],
    [7, 2, 'Jugo Naranja 1L', 420, 'SI'],
    [8, 2, 'Sprite 500ml', 340, 'SI'],
    [9, 3, 'Leche Entera 1L', 280, 'SI'],
    [10, 3, 'Yogur Natural 125g', 150, 'SI'],
    [11, 3, 'Queso Cremoso 200g', 520, 'SI'],
    [12, 3, 'Manteca 200g', 380, 'SI'],
    [13, 4, 'Pan Lactal 500g', 320, 'SI'],
    [14, 4, 'Medialunas x6', 450, 'SI'],
    [15, 4, 'Pan Hamburguesa x4', 380, 'SI'],
    [16, 5, 'Atún en Aceite 170g', 420, 'SI'],
    [17, 5, 'Tomate Triturado 400g', 280, 'SI'],
    [18, 5, 'Arvejas en Lata 300g', 250, 'SI']
  ],
  
  Pedidos: [
    ['pedido_id', 'fecha_hora', 'cliente_id', 'cliente_nombre', 'items_cantidad', 'total', 'estado']
  ],
  
  DetallePedidos: [
    ['detalle_id', 'pedido_id', 'producto_id', 'producto_nombre', 'categoria_id', 'cantidad', 'precio_unitario', 'importe']
  ]
};

async function crearHojas() {
  try {
    console.log('🚀 Iniciando configuración de Google Sheets...');
    
    // Verificar conexión
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID
    });
    
    console.log(`✅ Conectado a: ${spreadsheet.data.properties.title}`);
    
    // Obtener hojas existentes
    const existingSheets = spreadsheet.data.sheets?.map(sheet => 
      sheet.properties?.title
    ) || [];
    
    console.log('📋 Hojas existentes:', existingSheets);
    
    // Crear hojas faltantes
    const hojasNecesarias = Object.keys(datosEjemplo);
    
    for (const nombreHoja of hojasNecesarias) {
      if (!existingSheets.includes(nombreHoja)) {
        console.log(`📝 Creando hoja: ${nombreHoja}`);
        
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          requestBody: {
            requests: [{
              addSheet: {
                properties: {
                  title: nombreHoja
                }
              }
            }]
          }
        });
      } else {
        console.log(`✅ Hoja ya existe: ${nombreHoja}`);
      }
    }
    
    // Poblar hojas con datos
    for (const [nombreHoja, datos] of Object.entries(datosEjemplo)) {
      console.log(`📊 Poblando hoja: ${nombreHoja} con ${datos.length - 1} filas`);
      
      await sheets.spreadsheets.values.clear({
        spreadsheetId: SPREADSHEET_ID,
        range: `${nombreHoja}!A:Z`
      });
      
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${nombreHoja}!A1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: datos
        }
      });
    }
    
    console.log('🎉 ¡Configuración completada exitosamente!');
    console.log(`🔗 Ver hoja: https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`);
    
  } catch (error) {
    console.error('❌ Error configurando Google Sheets:', error);
    process.exit(1);
  }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  crearHojas();
}

module.exports = { crearHojas };