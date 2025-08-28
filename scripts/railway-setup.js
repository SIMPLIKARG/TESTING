#!/usr/bin/env node

/**
 * Script optimizado para Railway - Configuración automática del webhook
 * Se ejecuta automáticamente después del deploy o manualmente
 */

require('dotenv').config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const RAILWAY_STATIC_URL = process.env.RAILWAY_STATIC_URL;
const RAILWAY_ENVIRONMENT = process.env.RAILWAY_ENVIRONMENT || 'development';

async function setupRailwayWebhook() {
  try {
    console.log(`🚂 [Railway ${RAILWAY_ENVIRONMENT}] Configurando webhook...`);
    
    if (!TELEGRAM_BOT_TOKEN) {
      console.log('⚠️  TELEGRAM_BOT_TOKEN no configurado - saltando configuración de webhook');
      return;
    }
    
    if (!RAILWAY_STATIC_URL) {
      console.log('⚠️  RAILWAY_STATIC_URL no disponible. Esperando deployment...');
      console.log('');
      console.log('🔧 Una vez desplegado, configura manualmente:');
      console.log(`curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \\`);
      console.log('     -H "Content-Type: application/json" \\');
      console.log('     -d \'{"url": "https://TU-APP.railway.app/webhook"}\'');
      return;
    }
    
    const webhookUrl = `${RAILWAY_STATIC_URL}/webhook`;
    const apiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
    
    console.log(`🔗 URL del webhook: ${webhookUrl}`);
    
    // Verificar que la app esté funcionando
    console.log('🏥 Verificando health check...');
    try {
      const healthResponse = await fetch(`${RAILWAY_STATIC_URL}/health`);
      const healthData = await healthResponse.json();
      console.log(`✅ App funcionando: ${healthData.status}`);
    } catch (error) {
      console.log('⚠️  Health check falló, pero continuando...');
    }
    
    // Configurar webhook
    console.log('🔧 Configurando webhook de Telegram...');
    const response = await fetch(`${apiUrl}/setWebhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: webhookUrl,
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: true
      })
    });
    
    const result = await response.json();
    
    if (result.ok) {
      console.log('✅ Webhook configurado exitosamente');
      
      // Verificar configuración
      console.log('🔍 Verificando configuración...');
      const infoResponse = await fetch(`${apiUrl}/getWebhookInfo`);
      const info = await infoResponse.json();
      
      if (info.ok) {
        console.log('');
        console.log('📋 Información del webhook:');
        console.log(`   URL: ${info.result.url}`);
        console.log(`   SSL válido: ${info.result.has_custom_certificate ? 'Sí' : 'No'}`);
        console.log(`   Actualizaciones pendientes: ${info.result.pending_update_count}`);
        console.log(`   Máximo de conexiones: ${info.result.max_connections || 40}`);
        
        if (info.result.last_error_date) {
          console.log(`   ⚠️  Último error: ${new Date(info.result.last_error_date * 1000).toLocaleString()}`);
          console.log(`   Mensaje: ${info.result.last_error_message}`);
        } else {
          console.log('   ✅ Sin errores recientes');
        }
      }
      
    } else {
      console.error(`❌ Error configurando webhook: ${result.description}`);
      process.exit(1);
    }
    
    console.log('');
    console.log('🎉 ¡Configuración completada exitosamente!');
    console.log('');
    console.log('🔗 URLs importantes:');
    console.log(`   🌐 Dashboard: ${RAILWAY_STATIC_URL}`);
    console.log(`   🤖 Webhook: ${webhookUrl}`);
    console.log(`   🏥 Health: ${RAILWAY_STATIC_URL}/health`);
    console.log(`   📊 API Info: ${RAILWAY_STATIC_URL}/api/info`);
    console.log('');
    console.log('🧪 Prueba tu bot enviando un mensaje a @tu_bot en Telegram');
    
  } catch (error) {
    console.error('❌ Error en configuración:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Función para limpiar webhook (útil para desarrollo)
async function clearWebhook() {
  try {
    if (!TELEGRAM_BOT_TOKEN) {
      console.log('❌ TELEGRAM_BOT_TOKEN no configurado');
      return;
    }
    
    const apiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
    console.log('🧹 Limpiando webhook...');
    
    const response = await fetch(`${apiUrl}/deleteWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drop_pending_updates: true })
    });
    
    const result = await response.json();
    
    if (result.ok) {
      console.log('✅ Webhook eliminado exitosamente');
    } else {
      console.error(`❌ Error eliminando webhook: ${result.description}`);
    }
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
  }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  const command = process.argv[2];
  
  if (command === 'clear') {
    clearWebhook();
  } else {
    setupRailwayWebhook();
  }
}

module.exports = { setupRailwayWebhook, clearWebhook };