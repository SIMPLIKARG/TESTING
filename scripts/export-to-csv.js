#!/usr/bin/env node

/**
 * Script para exportar datos a archivos CSV individuales
 * Ejecutar con: node scripts/export-to-csv.js
 */

const fs = require('fs');
const path = require('path');
const { datosCompletos } = require('./create-sheets-data');

function arrayToCSV(data) {
  return data.map(row => 
    row.map(cell => {
      // Escapar comillas y envolver en comillas si contiene comas
      const cellStr = String(cell);
      if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
        return `"${cellStr.replace(/"/g, '""')}"`;
      }
      return cellStr;
    }).join(',')
  ).join('\n');
}

function exportarCSV() {
  console.log('📁 Creando archivos CSV...');
  
  // Crear directorio data si no existe
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  // Exportar cada hoja a CSV
  for (const [nombreHoja, datos] of Object.entries(datosCompletos)) {
    const csvContent = arrayToCSV(datos);
    const fileName = `${nombreHoja.toLowerCase()}.csv`;
    const filePath = path.join(dataDir, fileName);
    
    fs.writeFileSync(filePath, csvContent, 'utf8');
    console.log(`✅ ${fileName} creado con ${datos.length - 1} registros`);
  }
  
  // Crear archivo README para los CSV
  const readmeContent = `# Datos de Google Sheets

Este directorio contiene los archivos CSV con todos los datos de ejemplo para el sistema de distribuidora.

## Archivos incluidos:

- **clientes.csv**: Base de datos de clientes (${datosCompletos.Clientes.length - 1} registros)
- **categorias.csv**: Categorías de productos (${datosCompletos.Categorias.length - 1} registros)  
- **productos.csv**: Catálogo completo de productos (${datosCompletos.Productos.length - 1} registros)
- **pedidos.csv**: Pedidos de ejemplo (${datosCompletos.Pedidos.length - 1} registros)
- **detallepedidos.csv**: Detalles de cada pedido (${datosCompletos.DetallePedidos.length - 1} registros)

## Uso:

1. Puedes importar estos archivos directamente a Google Sheets
2. O usar el script \`create-sheets-data.js\` para poblar automáticamente
3. Los datos están listos para usar con el sistema de bot de Telegram

## Estructura de productos por categoría:

- **Galletitas**: 6 productos (Oreo, Pepitos, Tita, etc.)
- **Bebidas**: 6 productos (Coca Cola, Sprite, jugos, agua)
- **Lácteos**: 6 productos (leche, yogur, quesos, manteca)
- **Panadería**: 5 productos (pan lactal, medialunas, facturas)
- **Conservas**: 5 productos (atún, tomate, arvejas, mermeladas)
- **Snacks**: 4 productos (papas fritas, palitos, maní)
- **Dulces**: 4 productos (alfajores, chocolates, caramelos)
- **Limpieza**: 4 productos (detergente, lavandina, esponjas)
- **Higiene Personal**: 3 productos (shampoo, jabón, pasta dental)
- **Congelados**: 3 productos (hamburguesas, papas, helado)

Todos los precios están en pesos argentinos y son realistas para el mercado actual.
`;
  
  fs.writeFileSync(path.join(dataDir, 'README.md'), readmeContent, 'utf8');
  
  console.log('');
  console.log('🎉 ¡Archivos CSV exportados exitosamente!');
  console.log(`📁 Ubicación: ${dataDir}`);
  console.log('');
  console.log('📋 Archivos creados:');
  console.log('   - clientes.csv');
  console.log('   - categorias.csv');
  console.log('   - productos.csv');
  console.log('   - pedidos.csv');
  console.log('   - detallepedidos.csv');
  console.log('   - README.md');
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  exportarCSV();
}

module.exports = { exportarCSV };