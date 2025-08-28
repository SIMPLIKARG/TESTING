#!/usr/bin/env node

/**
 * Script para crear y poblar Google Sheets con datos de ejemplo
 * Ejecutar con: node scripts/create-sheets-data.js
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

// Datos completos para todas las hojas
const datosCompletos = {
  Clientes: [
    ['cliente_id', 'nombre', 'lista'],
    [1, 'Juan Pérez', 1],
    [2, 'María González', 2],
    [3, 'Carlos Rodríguez', 1],
    [4, 'Ana Martínez', 3],
    [5, 'Luis Fernández', 2],
    [6, 'Carmen López', 1],
    [7, 'Roberto Silva', 4],
    [8, 'Elena Morales', 2],
    [9, 'Diego Ramírez', 3],
    [10, 'Patricia Herrera', 1],
    [11, 'Miguel Torres', 5],
    [12, 'Sofía Castro', 2],
    [13, 'Andrés Vargas', 4],
    [14, 'Lucía Mendoza', 3],
    [15, 'Fernando Ruiz', 5]
  ],
  
  Categorias: [
    ['categoria_id', 'categoria_nombre'],
    [1, 'Galletitas'],
    [2, 'Bebidas'],
    [3, 'Lácteos'],
    [4, 'Panadería'],
    [5, 'Conservas'],
    [6, 'Snacks'],
    [7, 'Dulces'],
    [8, 'Limpieza'],
    [9, 'Higiene Personal'],
    [10, 'Congelados']
  ],
  
  Productos: [
    ['producto_id', 'categoria_id', 'producto_nombre', 'precio1', 'precio2', 'precio3', 'precio4', 'precio5', 'activo'],
    // Galletitas
    [1, 1, 'Oreo Original 117g', 450, 420, 400, 380, 360, 'SI'],
    [2, 1, 'Pepitos Chocolate 100g', 380, 360, 340, 320, 300, 'SI'],
    [3, 1, 'Tita Vainilla 168g', 320, 300, 280, 260, 240, 'SI'],
    [4, 1, 'Chocolinas 170g', 290, 270, 250, 230, 210, 'SI'],
    [5, 1, 'Criollitas Dulces 200g', 350, 330, 310, 290, 270, 'SI'],
    [6, 1, 'Sonrisas Frutilla 150g', 280, 260, 240, 220, 200, 'SI'],
    
    // Bebidas
    [7, 2, 'Coca Cola 500ml', 350, 330, 310, 290, 270, 'SI'],
    [8, 2, 'Agua Mineral 500ml', 180, 170, 160, 150, 140, 'SI'],
    [9, 2, 'Jugo Naranja 1L', 420, 400, 380, 360, 340, 'SI'],
    [10, 2, 'Sprite 500ml', 340, 320, 300, 280, 260, 'SI'],
    [11, 2, 'Fanta 500ml', 340, 320, 300, 280, 260, 'SI'],
    [12, 2, 'Agua con Gas 500ml', 200, 190, 180, 170, 160, 'SI'],
    
    // Lácteos
    [13, 3, 'Leche Entera 1L', 280, 260, 240, 220, 200, 'SI'],
    [14, 3, 'Yogur Natural 125g', 150, 140, 130, 120, 110, 'SI'],
    [15, 3, 'Queso Cremoso 200g', 520, 490, 460, 430, 400, 'SI'],
    [16, 3, 'Manteca 200g', 380, 360, 340, 320, 300, 'SI'],
    [17, 3, 'Dulce de Leche 400g', 450, 420, 390, 360, 330, 'SI'],
    [18, 3, 'Crema de Leche 200ml', 320, 300, 280, 260, 240, 'SI'],
    
    // Panadería
    [19, 4, 'Pan Lactal 500g', 320, 300, 280, 260, 240, 'SI'],
    [20, 4, 'Medialunas x6', 450, 420, 390, 360, 330, 'SI'],
    [21, 4, 'Pan Hamburguesa x4', 380, 360, 340, 320, 300, 'SI'],
    [22, 4, 'Tostadas x20', 280, 260, 240, 220, 200, 'SI'],
    [23, 4, 'Facturas Surtidas x6', 520, 490, 460, 430, 400, 'SI'],
    
    // Conservas
    [24, 5, 'Atún en Aceite 170g', 420, 400, 380, 360, 340, 'SI'],
    [25, 5, 'Tomate Triturado 400g', 280, 260, 240, 220, 200, 'SI'],
    [26, 5, 'Arvejas en Lata 300g', 250, 230, 210, 190, 170, 'SI'],
    [27, 5, 'Choclo en Lata 300g', 270, 250, 230, 210, 190, 'SI'],
    [28, 5, 'Mermelada Durazno 450g', 380, 360, 340, 320, 300, 'SI'],
    
    // Snacks
    [29, 6, 'Papas Fritas 150g', 320, 300, 280, 260, 240, 'SI'],
    [30, 6, 'Palitos Salados 100g', 180, 170, 160, 150, 140, 'SI'],
    [31, 6, 'Maní Salado 200g', 250, 230, 210, 190, 170, 'SI'],
    [32, 6, 'Chizitos 75g', 220, 200, 180, 160, 140, 'SI'],
    
    // Dulces
    [33, 7, 'Alfajor Havanna', 180, 170, 160, 150, 140, 'SI'],
    [34, 7, 'Chocolate Milka 100g', 450, 420, 390, 360, 330, 'SI'],
    [35, 7, 'Caramelos Sugus x10', 120, 110, 100, 90, 80, 'SI'],
    [36, 7, 'Chicles Beldent x5', 80, 75, 70, 65, 60, 'SI'],
    
    // Limpieza
    [37, 8, 'Detergente 500ml', 320, 300, 280, 260, 240, 'SI'],
    [38, 8, 'Lavandina 1L', 180, 170, 160, 150, 140, 'SI'],
    [39, 8, 'Esponja Cocina x3', 150, 140, 130, 120, 110, 'SI'],
    [40, 8, 'Papel Higiénico x4', 280, 260, 240, 220, 200, 'SI'],
    
    // Higiene Personal
    [41, 9, 'Shampoo 400ml', 450, 420, 390, 360, 330, 'SI'],
    [42, 9, 'Jabón Tocador x3', 220, 200, 180, 160, 140, 'SI'],
    [43, 9, 'Pasta Dental 90g', 180, 170, 160, 150, 140, 'SI'],
    
    // Congelados
    [44, 10, 'Hamburguesas x4', 520, 490, 460, 430, 400, 'SI'],
    [45, 10, 'Papas Congeladas 1kg', 380, 360, 340, 320, 300, 'SI'],
    [46, 10, 'Helado 1L', 650, 620, 590, 560, 530, 'SI']
  ],
  
  Pedidos: [
    ['pedido_id', 'fecha_hora', 'cliente_id', 'cliente_nombre', 'items_cantidad', 'total', 'estado'],
    ['PED001', '2024-01-15 10:30:00', 1, 'Juan Pérez', 3, 1180, 'CONFIRMADO'],
    ['PED002', '2024-01-15 14:20:00', 2, 'María González', 2, 770, 'CONFIRMADO'],
    ['PED003', '2024-01-15 16:45:00', 3, 'Carlos Rodríguez', 4, 1520, 'CONFIRMADO'],
    ['PED004', '2024-01-16 09:15:00', 4, 'Ana Martínez', 2, 630, 'CONFIRMADO'],
    ['PED005', '2024-01-16 11:30:00', 5, 'Luis Fernández', 5, 2150, 'CONFIRMADO'],
    ['PED006', '2024-01-16 15:20:00', 1, 'Juan Pérez', 1, 450, 'BORRADOR'],
    ['PED007', '2024-01-17 08:45:00', 6, 'Carmen López', 3, 980, 'CONFIRMADO'],
    ['PED008', '2024-01-17 12:10:00', 7, 'Roberto Silva', 2, 700, 'CONFIRMADO'],
    ['PED009', '2024-01-17 17:30:00', 8, 'Elena Morales', 4, 1680, 'CONFIRMADO'],
    ['PED010', '2024-01-18 10:00:00', 9, 'Diego Ramírez', 1, 320, 'BORRADOR']
  ],
  
  DetallePedidos: [
    ['detalle_id', 'pedido_id', 'producto_id', 'producto_nombre', 'categoria_id', 'cantidad', 'precio_unitario', 'importe', 'observaciones'],
    ['DET001', 'PED001', 1, 'Oreo Original 117g', 1, 2, 450, 900, ''],
    ['DET002', 'PED001', 13, 'Leche Entera 1L', 3, 1, 280, 280, ''],
    ['DET003', 'PED002', 7, 'Coca Cola 500ml', 2, 1, 350, 350, ''],
    ['DET004', 'PED002', 24, 'Atún en Aceite 170g', 5, 1, 420, 420, ''],
    ['DET005', 'PED003', 1, 'Oreo Original 117g', 1, 1, 450, 450, ''],
    ['DET006', 'PED003', 15, 'Queso Cremoso 200g', 3, 1, 520, 520, ''],
    ['DET007', 'PED003', 19, 'Pan Lactal 500g', 4, 1, 320, 320, ''],
    ['DET008', 'PED003', 29, 'Papas Fritas 150g', 6, 1, 320, 320, ''],
    ['DET009', 'PED004', 2, 'Pepitos Chocolate 100g', 1, 1, 380, 380, ''],
    ['DET010', 'PED004', 14, 'Yogur Natural 125g', 3, 2, 150, 300, ''],
    ['DET011', 'PED005', 33, 'Alfajor Havanna', 7, 5, 180, 900, 'Para el cumpleaños'],
    ['DET012', 'PED005', 7, 'Coca Cola 500ml', 2, 2, 350, 700, ''],
    ['DET013', 'PED005', 15, 'Queso Cremoso 200g', 3, 1, 520, 520, ''],
    ['DET014', 'PED005', 46, 'Helado 1L', 10, 1, 650, 650, 'Sabor vainilla si hay'],
    ['DET015', 'PED006', 1, 'Oreo Original 117g', 1, 1, 450, 450, ''],
    ['DET016', 'PED007', 20, 'Medialunas x6', 4, 1, 450, 450, ''],
    ['DET017', 'PED007', 13, 'Leche Entera 1L', 3, 1, 280, 280, ''],
    ['DET018', 'PED007', 29, 'Papas Fritas 150g', 6, 1, 320, 320, ''],
    ['DET019', 'PED008', 34, 'Chocolate Milka 100g', 7, 1, 450, 450, ''],
    ['DET020', 'PED008', 29, 'Papas Fritas 150g', 6, 1, 320, 320, ''],
    ['DET021', 'PED009', 44, 'Hamburguesas x4', 10, 2, 520, 1040, 'Bien cocidas por favor'],
    ['DET022', 'PED009', 45, 'Papas Congeladas 1kg', 10, 1, 380, 380, ''],
    ['DET023', 'PED009', 11, 'Fanta 500ml', 2, 1, 340, 340, ''],
    ['DET024', 'PED010', 19, 'Pan Lactal 500g', 4, 1, 320, 320, 'Sin sal si es posible']
  ]
};

async function crearYPoblarSheets() {
  try {
    console.log('🚀 Iniciando creación y población de Google Sheets...');
    
    if (!SPREADSHEET_ID) {
      throw new Error('GOOGLE_SHEETS_ID no está configurado en .env');
    }
    
    // Verificar conexión
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID
    });
    
    console.log(`✅ Conectado a: "${spreadsheet.data.properties?.title}"`);
    
    // Obtener hojas existentes
    const existingSheets = spreadsheet.data.sheets?.map(sheet => 
      sheet.properties?.title
    ) || [];
    
    console.log('📋 Hojas existentes:', existingSheets);
    
    // Crear hojas faltantes
    const hojasNecesarias = Object.keys(datosCompletos);
    
    for (const nombreHoja of hojasNecesarias) {
      if (!existingSheets.includes(nombreHoja)) {
        console.log(`📝 Creando hoja: "${nombreHoja}"`);
        
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
        
        console.log(`✅ Hoja "${nombreHoja}" creada exitosamente`);
      } else {
        console.log(`ℹ️  Hoja "${nombreHoja}" ya existe`);
      }
    }
    
    // Poblar hojas con datos
    for (const [nombreHoja, datos] of Object.entries(datosCompletos)) {
      console.log(`📊 Poblando "${nombreHoja}" con ${datos.length - 1} registros...`);
      
      // Limpiar hoja primero
      await sheets.spreadsheets.values.clear({
        spreadsheetId: SPREADSHEET_ID,
        range: `${nombreHoja}!A:Z`
      });
      
      // Insertar datos
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${nombreHoja}!A1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: datos
        }
      });
      
      console.log(`✅ "${nombreHoja}" poblada exitosamente`);
    }
    
    // Formatear encabezados
    console.log('🎨 Aplicando formato a encabezados...');
    
    const formatRequests = hojasNecesarias.map(nombreHoja => ({
      repeatCell: {
        range: {
          sheetId: 0, // Se actualizará dinámicamente
          startRowIndex: 0,
          endRowIndex: 1
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.2, green: 0.4, blue: 0.8 },
            textFormat: {
              foregroundColor: { red: 1, green: 1, blue: 1 },
              bold: true
            }
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat)'
      }
    }));
    
    console.log('🎉 ¡Configuración completada exitosamente!');
    console.log('');
    console.log('📊 RESUMEN DE DATOS CREADOS:');
    console.log(`   👥 Clientes: ${datosCompletos.Clientes.length - 1}`);
    console.log(`   📂 Categorías: ${datosCompletos.Categorias.length - 1}`);
    console.log(`   📦 Productos: ${datosCompletos.Productos.length - 1}`);
    console.log(`   🛒 Pedidos: ${datosCompletos.Pedidos.length - 1}`);
    console.log(`   📋 Detalles: ${datosCompletos.DetallePedidos.length - 1}`);
    console.log('');
    console.log(`🔗 Ver hoja: https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`);
    
  } catch (error) {
    console.error('❌ Error configurando Google Sheets:', error.message);
    process.exit(1);
  }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  crearYPoblarSheets();
}

module.exports = { crearYPoblarSheets, datosCompletos };