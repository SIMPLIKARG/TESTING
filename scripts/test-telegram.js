#!/usr/bin/env node

/**
 * Script para probar la configuración del bot de Telegram
 * Ejecutar con: node scripts/test-telegram.js
 */

require('dotenv').config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_WEBHOOK_URL = process.env.TELEGRAM_WEBHOOK_URL;

async function testTelegramBot() {
  try {
    console.log('🤖 Probando configuración del bot de Telegram...');
    
    if (!TELEGRAM_BOT_TOKEN) {
      throw new Error('TELEGRAM_BOT_TOKEN no configurado en .env');
    }
    
    const apiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
    
    // Probar getMe
    console.log('📋 Obteniendo información del bot...');
    const meResponse = await fetch(`${apiUrl}/getMe`);
    const meData = await meResponse.json();
    
    if (meData.ok) {
      console.log(`✅ Bot conectado: @${meData.result.username}`);
      console.log(`   Nombre: ${meData.result.first_name}`);
      console.log(`   ID: ${meData.result.id}`);
    } else {
      throw new Error(`Error obteniendo info del bot: ${meData.description}`);
    }
    
    // Probar webhook info
    console.log('🔗 Verificando configuración del webhook...');
    const webhookResponse = await fetch(`${apiUrl}/getWebhookInfo`);
    const webhookData = await webhookResponse.json();
    
    if (webhookData.ok) {
      const info = webhookData.result;
      console.log(`   URL actual: ${info.url || 'No configurada'}`);
      console.log(`   Certificado: ${info.has_custom_certificate ? 'Sí' : 'No'}`);
      console.log(`   Actualizaciones pendientes: ${info.pending_update_count}`);
      
      if (info.last_error_date) {
        console.log(`⚠️  Último error: ${new Date(info.last_error_date * 1000).toLocaleString()}`);
        console.log(`   Mensaje: ${info.last_error_message}`);
      }
    }
    
    // Configurar webhook si está definido
    if (TELEGRAM_WEBHOOK_URL) {
      console.log('🔧 Configurando webhook...');
      const setWebhookResponse = await fetch(`${apiUrl}/setWebhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: TELEGRAM_WEBHOOK_URL
        })
      });
      
      const setWebhookData = await setWebhookResponse.json();
      
      if (setWebhookData.ok) {
        console.log(`✅ Webhook configurado: ${TELEGRAM_WEBHOOK_URL}`);
      } else {
        console.log(`❌ Error configurando webhook: ${setWebhookData.description}`);
      }
    } else {
      console.log('⚠️  TELEGRAM_WEBHOOK_URL no configurada');
    }
    
    console.log('🎉 ¡Prueba de Telegram completada!');
    
  } catch (error) {
    console.error('❌ Error probando Telegram:', error.message);
    process.exit(1);
  }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  testTelegramBot();
}

module.exports = { testTelegramBot };