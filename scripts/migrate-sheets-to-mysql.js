#!/usr/bin/env node

/**
 * Script para migrar datos de Google Sheets a MySQL
 * Ejecutar con: node scripts/migrate-sheets-to-mysql.js
 */

import { google } from 'googleapis';
import { createPool } from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

let sheets;
const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;

// Configuración de MySQL
const pool = createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  port: process.env.MYSQL_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Función para obtener datos de Google Sheets
async function obtenerDatosSheet(nombreHoja) {
  try {
    console.log(`📊 Obteniendo datos de Google Sheet: ${nombreHoja}...`);
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${nombreHoja}!A:Z`,
    });

    const rows = response.data.values || [];
    console.log(`📋 ${nombreHoja}: ${rows.length} filas obtenidas`);
    
    if (rows.length === 0) return [];

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
        if (nombreHoja === 'Pedidos') {
          return obj.pedido_id && obj.cliente_nombre && obj.cliente_nombre !== '';
        }
        if (nombreHoja === 'DetallePedidos') {
          return obj.detalle_id && obj.pedido_id && obj.producto_nombre;
        }
        return Object.values(obj).some(val => val && val !== '');
      });

    console.log(`✅ ${nombreHoja}: ${data.length} registros válidos procesados`);
    return data;
  } catch (error) {
    console.error(`❌ Error obteniendo datos de ${nombreHoja}:`, error.message);
    return [];
  }
}

// Función para migrar Clientes
async function migrarClientes() {
  try {
    console.log('👥 Migrando Clientes...');
    
    const clientes = await obtenerDatosSheet('Clientes');
    
    if (clientes.length === 0) {
      console.log('⚠️ No hay clientes para migrar');
      return;
    }
    
    // Limpiar tabla primero
    await pool.execute('DELETE FROM Clientes');
    console.log('🧹 Tabla Clientes limpiada');
    
    // Insertar clientes
    for (const cliente of clientes) {
      const query = `INSERT INTO Clientes (cliente_id, nombre, lista, localidad) VALUES (?, ?, ?, ?)`;
      const values = [
        parseInt(cliente.cliente_id) || 0,
        cliente.nombre || '',
        parseInt(cliente.lista) || 1,
        cliente.localidad || 'Sin localidad'
      ];
      
      await pool.execute(query, values);
    }
    
    console.log(`✅ ${clientes.length} clientes migrados exitosamente`);
  } catch (error) {
    console.error('❌ Error migrando clientes:', error.message);
  }
}

// Función para migrar Categorías
async function migrarCategorias() {
  try {
    console.log('📂 Migrando Categorías...');
    
    const categorias = await obtenerDatosSheet('Categorias');
    
    if (categorias.length === 0) {
      console.log('⚠️ No hay categorías para migrar');
      return;
    }
    
    // Limpiar tabla primero
    await pool.execute('DELETE FROM Categorias');
    console.log('🧹 Tabla Categorias limpiada');
    
    // Insertar categorías
    for (const categoria of categorias) {
      const query = `INSERT INTO Categorias (categoria_id, categoria_nombre) VALUES (?, ?)`;
      const values = [
        parseInt(categoria.categoria_id) || 0,
        categoria.categoria_nombre || ''
      ];
      
      await pool.execute(query, values);
    }
    
    console.log(`✅ ${categorias.length} categorías migradas exitosamente`);
  } catch (error) {
    console.error('❌ Error migrando categorías:', error.message);
  }
}

// Función para migrar Productos
async function migrarProductos() {
  try {
    console.log('📦 Migrando Productos...');
    
    const productos = await obtenerDatosSheet('Productos');
    
    if (productos.length === 0) {
      console.log('⚠️ No hay productos para migrar');
      return;
    }
    
    // Limpiar tabla primero
    await pool.execute('DELETE FROM Productos');
    console.log('🧹 Tabla Productos limpiada');
    
    // Insertar productos
    for (const producto of productos) {
      const query = `INSERT INTO Productos (producto_id, categoria_id, producto_nombre, precio1, precio2, precio3, precio4, precio5, activo, proveedor_id, proveedor_nombre) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      const values = [
        parseInt(producto.producto_id) || 0,
        parseInt(producto.categoria_id) || 0,
        producto.producto_nombre || '',
        parseFloat(producto.precio1 || producto.precio) || 0,
        parseFloat(producto.precio2) || 0,
        parseFloat(producto.precio3) || 0,
        parseFloat(producto.precio4) || 0,
        parseFloat(producto.precio5) || 0,
        producto.activo || 'SI',
        producto.proveedor_id || '',
        producto.proveedor_nombre || ''
      ];
      
      await pool.execute(query, values);
    }
    
    console.log(`✅ ${productos.length} productos migrados exitosamente`);
  } catch (error) {
    console.error('❌ Error migrando productos:', error.message);
  }
}

// Función para migrar Pedidos
async function migrarPedidos() {
  try {
    console.log('🛒 Migrando Pedidos...');
    
    const pedidos = await obtenerDatosSheet('Pedidos');
    
    if (pedidos.length === 0) {
      console.log('⚠️ No hay pedidos para migrar');
      return;
    }
    
    // Limpiar tabla primero
    await pool.execute('DELETE FROM Pedidos');
    console.log('🧹 Tabla Pedidos limpiada');
    
    // Insertar pedidos
    for (const pedido of pedidos) {
      const query = `INSERT INTO Pedidos (pedido_id, fecha_hora, cliente_id, cliente_nombre, items_cantidad, total, estado, observacion) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
      const values = [
        pedido.pedido_id || '',
        pedido.fecha_hora || new Date().toISOString(),
        parseInt(pedido.cliente_id) || 0,
        pedido.cliente_nombre || '',
        parseInt(pedido.items_cantidad) || 0,
        parseFloat(pedido.total) || 0,
        pedido.estado || 'PENDIENTE',
        pedido.observacion || ''
      ];
      
      await pool.execute(query, values);
    }
    
    console.log(`✅ ${pedidos.length} pedidos migrados exitosamente`);
  } catch (error) {
    console.error('❌ Error migrando pedidos:', error.message);
  }
}

// Función para migrar DetallePedidos
async function migrarDetallePedidos() {
  try {
    console.log('📋 Migrando DetallePedidos...');
    
    const detalles = await obtenerDatosSheet('DetallePedidos');
    
    if (detalles.length === 0) {
      console.log('⚠️ No hay detalles de pedidos para migrar');
      return;
    }
    
    // Limpiar tabla primero
    await pool.execute('DELETE FROM DetallePedidos');
    console.log('🧹 Tabla DetallePedidos limpiada');
    
    // Insertar detalles
    for (const detalle of detalles) {
      const query = `INSERT INTO DetallePedidos (detalle_id, pedido_id, producto_id, producto_nombre, categoria_id, cantidad, precio_unitario, importe, observaciones) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      const values = [
        detalle.detalle_id || '',
        detalle.pedido_id || '',
        parseInt(detalle.producto_id) || 0,
        detalle.producto_nombre || '',
        parseInt(detalle.categoria_id) || 0,
        parseInt(detalle.cantidad) || 0,
        parseFloat(detalle.precio_unitario) || 0,
        parseFloat(detalle.importe) || 0,
        detalle.observaciones || ''
      ];
      
      await pool.execute(query, values);
    }
    
    console.log(`✅ ${detalles.length} detalles de pedidos migrados exitosamente`);
  } catch (error) {
    console.error('❌ Error migrando detalles de pedidos:', error.message);
  }
}

// Función principal de migración
async function ejecutarMigracion() {
  try {
    console.log('🚀 Iniciando migración de Google Sheets a MySQL...');
    console.log('');
    
    // Verificar conexiones
    console.log('🔍 Verificando conexiones...');
    
    // Configuración de Google Sheets usando googleapis directamente
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    // Inicializar cliente autenticado de Google
    const authClient = await auth.getClient();
    sheets = google.sheets({ version: 'v4', auth: authClient });
    
    // Verificar Google Sheets
    if (!SPREADSHEET_ID) {
      throw new Error('GOOGLE_SHEETS_ID no está configurado');
    }
    
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID
    });
    console.log(`✅ Google Sheets conectado: "${spreadsheet.data.properties?.title}"`);
    
    // Verificar MySQL
    const connection = await pool.getConnection();
    const [rows] = await connection.execute('SELECT DATABASE() as db_name');
    console.log(`✅ MySQL conectado: "${rows[0].db_name}"`);
    connection.release();
    
    console.log('');
    console.log('📊 Iniciando migración de datos...');
    console.log('');
    
    // Migrar en orden (respetando dependencias)
    await migrarClientes();
    await migrarCategorias();
    await migrarProductos();
    await migrarPedidos();
    await migrarDetallePedidos();
    
    console.log('');
    console.log('🎉 ¡Migración completada exitosamente!');
    console.log('');
    console.log('📊 Resumen:');
    
    // Mostrar estadísticas finales
    const [clientesCount] = await pool.execute('SELECT COUNT(*) as count FROM Clientes');
    const [categoriasCount] = await pool.execute('SELECT COUNT(*) as count FROM Categorias');
    const [productosCount] = await pool.execute('SELECT COUNT(*) as count FROM Productos');
    const [pedidosCount] = await pool.execute('SELECT COUNT(*) as count FROM Pedidos');
    const [detallesCount] = await pool.execute('SELECT COUNT(*) as count FROM DetallePedidos');
    
    console.log(`   👥 Clientes: ${clientesCount[0].count}`);
    console.log(`   📂 Categorías: ${categoriasCount[0].count}`);
    console.log(`   📦 Productos: ${productosCount[0].count}`);
    console.log(`   🛒 Pedidos: ${pedidosCount[0].count}`);
    console.log(`   📋 Detalles: ${detallesCount[0].count}`);
    console.log('');
    console.log('✅ Todos los datos han sido migrados a MySQL');
    console.log('🔄 Ahora puedes actualizar server.js para usar MySQL');
    
  } catch (error) {
    console.error('❌ Error en la migración:', error.message);
    console.error('');
    console.error('🔍 Verifica que:');
    console.error('   - Las variables de entorno estén correctamente configuradas');
    console.error('   - Google Sheets esté accesible');
    console.error('   - MySQL esté conectado y las tablas creadas');
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Ejecutar migración
ejecutarMigracion();