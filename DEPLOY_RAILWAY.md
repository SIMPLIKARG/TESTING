# 🚂 Guía de Despliegue en Railway

## 🎯 Optimizado según Railway Docs

Este proyecto está completamente optimizado siguiendo las mejores prácticas de Railway:
- ✅ **Nixpacks** para build automático
- ✅ **Health checks** configurados
- ✅ **Graceful shutdown** implementado
- ✅ **Logging estructurado** para Railway
- ✅ **Variables de entorno** optimizadas
- ✅ **Build híbrido** (frontend + backend)

## 📋 Pasos para Desplegar

### 1. **Preparar el Repositorio**
```bash
git add .
git commit -m "Optimizado para Railway deployment"
git push origin main
```

### 2. **Crear Proyecto en Railway**
1. Ve a [railway.app](https://railway.app)
2. **Sign up** con GitHub
3. **New Project** → **Deploy from GitHub repo**
4. Selecciona tu repositorio
5. Railway detectará automáticamente el proyecto Node.js

### 3. **Configurar Variables de Entorno**

En el dashboard de Railway → **Variables**, agrega **SOLO ESTAS**:

```env
# Google Sheets (REQUERIDO)
GOOGLE_SHEETS_ID=tu_sheet_id_aqui
GOOGLE_SERVICE_ACCOUNT_EMAIL=tu-cuenta-servicio@proyecto.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\ntu_clave_privada_aqui\n-----END PRIVATE KEY-----\n"

# Telegram (REQUERIDO)
TELEGRAM_BOT_TOKEN=tu_token_de_telegram_aqui

# Seguridad (REQUERIDO)
NODE_ENV=production
JWT_SECRET=tu_jwt_secret_muy_seguro_aqui
WEBHOOK_SECRET=tu_webhook_secret_aqui
```

**⚠️ NO CONFIGURES ESTAS** (Railway las maneja automáticamente):
- `PORT`
- `RAILWAY_STATIC_URL` 
- `RAILWAY_ENVIRONMENT`

### 4. **Despliegue Automático**
Railway automáticamente:
1. **Detecta** el proyecto como Node.js
2. **Instala** dependencias con `npm ci`
3. **Construye** con `npm run build`
4. **Inicia** con `npm start`
5. **Asigna** una URL pública

### 5. **Configurar Webhook (Post-Deploy)**

**Opción A: Automático**
```bash
# Después del primer deploy
npm run railway:setup
```

**Opción B: Manual**
```bash
curl -X POST "https://api.telegram.org/botTU_TOKEN/setWebhook" \
     -H "Content-Type: application/json" \
     -d '{"url": "https://tu-app.railway.app/webhook"}'
```

### 6. **Verificar Despliegue**

```bash
# Health check
curl https://tu-app.railway.app/health

# Info de la API
curl https://tu-app.railway.app/api/info

# Test Google Sheets
curl https://tu-app.railway.app/api/test/sheets
```

## 🔧 Características Railway

### **Build Automático**
- **Nixpacks** detecta Node.js automáticamente
- **Build híbrido**: Frontend (Vite) + Backend (Express)
- **Optimizaciones**: Tree shaking, minificación, chunks
- **TypeScript**: Compilación automática

### **Runtime Optimizado**
- **Puerto dinámico**: `process.env.PORT`
- **Health checks**: `/health` endpoint
- **Graceful shutdown**: SIGTERM/SIGINT handlers
- **Error handling**: Logging estructurado

### **Monitoreo Integrado**
- **Logs en tiempo real** en el dashboard
- **Métricas de CPU/memoria** automáticas
- **Restart automático** en caso de fallo
- **Deploy tracking** con git commits

## 🚀 Comandos Útiles

### **Railway CLI** (Opcional)
```bash
# Instalar CLI
npm install -g @railway/cli

# Conectar proyecto
railway login
railway link

# Ver logs
railway logs

# Variables
railway variables

# Deploy manual
railway up
```

### **Scripts del Proyecto**
```bash
# Setup webhook después del deploy
npm run railway:setup

# Health check rápido
npm run railway:health

# Ver logs (requiere Railway CLI)
npm run railway:logs
```

## 📊 URLs Importantes

Una vez desplegado tendrás:

```bash
# Aplicación principal
https://tu-app.railway.app

# Dashboard web
https://tu-app.railway.app/

# API endpoints
https://tu-app.railway.app/api/info
https://tu-app.railway.app/api/clientes
https://tu-app.railway.app/api/productos

# Telegram webhook
https://tu-app.railway.app/webhook

# Health check
https://tu-app.railway.app/health
```

## 🐛 Solución de Problemas

### **Build Failures**
```bash
# Ver logs de build en Railway dashboard
# O usar CLI:
railway logs --deployment
```

### **Runtime Errors**
```bash
# Ver logs en tiempo real
railway logs --follow

# Health check
curl https://tu-app.railway.app/health
```

### **Variables de Entorno**
```bash
# Verificar variables
railway variables

# Agregar variable faltante
railway variables set VARIABLE_NAME=value
```

### **Webhook Issues**
```bash
# Limpiar webhook
node scripts/railway-setup.js clear

# Reconfigurar
npm run railway:setup
```

## 🔍 Debugging

### **Logs Estructurados**
El servidor incluye logging detallado:
- ✅ Requests HTTP
- ✅ Errores de Google Sheets
- ✅ Webhooks de Telegram
- ✅ Health checks
- ✅ Startup/shutdown

### **Health Check Detallado**
```json
{
  "status": "OK",
  "timestamp": "2024-01-20T10:30:00.000Z",
  "environment": "production",
  "port": 3000,
  "uptime": 3600,
  "memory": {...},
  "version": "v18.17.0"
}
```

## 🎯 Optimizaciones Railway

### **Performance**
- ✅ **Static file serving** optimizado
- ✅ **Gzip compression** habilitado
- ✅ **Caching headers** configurados
- ✅ **Bundle splitting** para JS/CSS

### **Reliability**
- ✅ **Graceful shutdown** en 30s
- ✅ **Health checks** cada 30s
- ✅ **Auto-restart** en fallos
- ✅ **Error boundaries** implementados

### **Security**
- ✅ **Helmet.js** para headers de seguridad
- ✅ **CORS** configurado para Railway
- ✅ **Environment isolation** 
- ✅ **Secrets management** con Railway

## 🎉 ¡Listo!

**Tu sistema estará completamente funcional con:**

✅ **Bot de Telegram** completamente funcional  
✅ **Dashboard web** con estadísticas en tiempo real  
✅ **API REST** para todos los datos  
✅ **Integración Google Sheets** para persistencia  
✅ **Monitoreo automático** con Railway  
✅ **Logs estructurados** para debugging  
✅ **Auto-scaling** según demanda  
✅ **SSL/HTTPS** automático  

**🌐 Tu URL será**: `https://[proyecto-nombre].railway.app`