# 🚀 Guía Completa de Configuración - Sistema Distribuidora Bot

## 📋 Índice
1. [Configuración de Google Sheets](#1-configuración-de-google-sheets)
2. [Configuración de Google Cloud Console](#2-configuración-de-google-cloud-console)
3. [Configuración del Bot de Telegram](#3-configuración-del-bot-de-telegram)
4. [Configuración del Proyecto](#4-configuración-del-proyecto)
5. [Variables de Entorno](#5-variables-de-entorno)
6. [Despliegue](#6-despliegue)
7. [Pruebas](#7-pruebas)

---

## 1. Configuración de Google Sheets

### Paso 1.1: Crear la Hoja de Cálculo
1. Ve a [Google Sheets](https://sheets.google.com)
2. Crea una nueva hoja de cálculo
3. Nómbrala: **"Distribuidora - Base de Datos"**
4. Copia el ID de la hoja desde la URL: `https://docs.google.com/spreadsheets/d/[SHEET_ID]/edit`

### Paso 1.2: Crear las Pestañas
Crea 5 pestañas con estos nombres exactos:
- `Clientes`
- `Categorias`
- `Productos`
- `Pedidos`
- `DetallePedidos`

### Paso 1.3: Configurar Encabezados

#### Pestaña "Clientes"
```
A1: cliente_id
B1: nombre
```

#### Pestaña "Categorias"
```
A1: categoria_id
B1: categoria_nombre
```

#### Pestaña "Productos"
```
A1: producto_id
B1: categoria_id
C1: producto_nombre
D1: precio
E1: activo
```

#### Pestaña "Pedidos"
```
A1: pedido_id
B1: fecha_hora
C1: cliente_id
D1: cliente_nombre
E1: items_cantidad
F1: total
G1: estado
```

#### Pestaña "DetallePedidos"
```
A1: detalle_id
B1: pedido_id
C1: producto_id
D1: producto_nombre
E1: categoria_id
F1: cantidad
G1: precio_unitario
H1: importe
```

### Paso 1.4: Agregar Datos de Ejemplo

#### En "Clientes" (fila 2 en adelante):
```
1	Juan Pérez
2	María González
3	Carlos Rodríguez
4	Ana Martínez
5	Luis Fernández
```

#### En "Categorias" (fila 2 en adelante):
```
1	Galletitas
2	Bebidas
3	Lácteos
4	Panadería
5	Conservas
```

#### En "Productos" (fila 2 en adelante):
```
1	1	Oreo Original 117g	450	SI
2	1	Pepitos Chocolate 100g	380	SI
3	1	Tita Vainilla 168g	320	SI
4	2	Coca Cola 500ml	350	SI
5	2	Agua Mineral 500ml	180	SI
6	3	Leche Entera 1L	280	SI
7	3	Yogur Natural 125g	150	SI
```

---

## 2. Configuración de Google Cloud Console

### Paso 2.1: Crear Proyecto
1. Ve a [Google Cloud Console](https://console.cloud.google.com)
2. Crea un nuevo proyecto: **"Distribuidora Bot"**
3. Selecciona el proyecto creado

### Paso 2.2: Habilitar APIs
1. Ve a **"APIs y servicios" > "Biblioteca"**
2. Busca y habilita:
   - **Google Sheets API**
   - **Google Drive API**

### Paso 2.3: Crear Credenciales
1. Ve a **"APIs y servicios" > "Credenciales"**
2. Clic en **"+ CREAR CREDENCIALES"**
3. Selecciona **"Cuenta de servicio"**
4. Nombre: `distribuidora-bot-service`
5. Descripción: `Cuenta de servicio para el bot de distribuidora`
6. Clic en **"CREAR Y CONTINUAR"**
7. Rol: **"Editor"** (o más específico: "Editor de Hojas de cálculo de Google")
8. Clic en **"CONTINUAR"** y **"LISTO"**

### Paso 2.4: Generar Clave JSON
1. En la lista de cuentas de servicio, clic en la cuenta creada
2. Ve a la pestaña **"CLAVES"**
3. Clic en **"AGREGAR CLAVE" > "Crear clave nueva"**
4. Selecciona **JSON** y clic en **"CREAR"**
5. Se descargará un archivo JSON - **¡GUÁRDALO SEGURO!**

### Paso 2.5: Compartir Google Sheets
1. Abre tu Google Sheets
2. Clic en **"Compartir"**
3. Agrega el email de la cuenta de servicio (está en el JSON descargado)
4. Dale permisos de **"Editor"**

---

## 3. Configuración del Bot de Telegram

### Paso 3.1: Crear Bot con BotFather
1. Abre Telegram y busca **@BotFather**
2. Envía `/newbot`
3. Nombre del bot: `Distribuidora Bot`
4. Username: `tu_distribuidora_bot` (debe terminar en 'bot')
5. **¡GUARDA EL TOKEN QUE TE DA!**

### Paso 3.2: Configurar Bot
Envía estos comandos a @BotFather:
```
/setdescription
Descripción: Bot para gestión de pedidos de distribuidora

/setabouttext
Acerca de: Sistema automatizado para tomar pedidos de productos alimenticios

/setcommands
start - Iniciar nuevo pedido
ayuda - Ver comandos disponibles
```

---

## 4. Configuración del Proyecto

### Paso 4.1: Instalar Dependencias
```bash
npm install googleapis dotenv express cors helmet
npm install -D @types/express @types/cors
```

### Paso 4.2: Estructura de Archivos
```
src/
├── config/
│   └── google-sheets.ts
├── services/
│   ├── googleSheets.ts
│   └── telegram.ts
├── controllers/
│   ├── botController.ts
│   └── webhookController.ts
├── middleware/
│   └── auth.ts
└── server.ts
```

---

## 5. Variables de Entorno

### Paso 5.1: Crear archivo .env
```env
# Google Sheets
GOOGLE_SHEETS_ID=tu_sheet_id_aqui
GOOGLE_SERVICE_ACCOUNT_EMAIL=tu-cuenta-servicio@proyecto.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\ntu_clave_privada_aqui\n-----END PRIVATE KEY-----\n"

# Telegram
TELEGRAM_BOT_TOKEN=tu_token_de_telegram_aqui
TELEGRAM_WEBHOOK_URL=https://tu-dominio.com/webhook

# Servidor
PORT=3000
NODE_ENV=production

# Seguridad
JWT_SECRET=tu_jwt_secret_muy_seguro_aqui
WEBHOOK_SECRET=tu_webhook_secret_aqui
```

### Paso 5.2: Configurar Google Sheets Service
```typescript
// src/config/google-sheets.ts
import { GoogleAuth } from 'google-auth-library';
import { sheets_v4, google } from 'googleapis';

const auth = new GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

export const sheets = google.sheets({ version: 'v4', auth });
export const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID!;
```

---

## 6. Despliegue

### Opción A: Vercel (Recomendado)
1. Instala Vercel CLI: `npm i -g vercel`
2. En la raíz del proyecto: `vercel`
3. Configura las variables de entorno en el dashboard de Vercel
4. Configura el webhook de Telegram:
```bash
curl -X POST "https://api.telegram.org/bot[TOKEN]/setWebhook" \
     -H "Content-Type: application/json" \
     -d '{"url": "https://tu-app.vercel.app/api/webhook"}'
```

### Opción B: Railway
1. Conecta tu repositorio en [Railway](https://railway.app)
2. Configura las variables de entorno
3. Despliega automáticamente

### Opción C: Heroku
1. Instala Heroku CLI
2. `heroku create tu-distribuidora-bot`
3. Configura variables: `heroku config:set VARIABLE=valor`
4. `git push heroku main`

---

## 7. Pruebas

### Paso 7.1: Verificar Google Sheets
```bash
# Prueba la conexión
curl -X GET "https://tu-app.com/api/test/sheets"
```

### Paso 7.2: Probar Bot de Telegram
1. Busca tu bot en Telegram
2. Envía `/start`
3. Sigue el flujo completo de pedido

### Paso 7.3: Verificar Webhook
```bash
# Verificar que el webhook esté configurado
curl "https://api.telegram.org/bot[TOKEN]/getWebhookInfo"
```

---

## 🔧 Solución de Problemas Comunes

### Error: "The caller does not have permission"
- Verifica que compartiste la Google Sheet con la cuenta de servicio
- Revisa que los permisos sean de "Editor"

### Error: "Webhook not found"
- Configura el webhook con la URL correcta
- Verifica que tu servidor esté accesible públicamente

### Error: "Invalid token"
- Revisa que el token de Telegram sea correcto
- Verifica que no tenga espacios extra

### Error: "Sheet not found"
- Verifica el ID de la Google Sheet
- Asegúrate de que las pestañas tengan los nombres exactos

---

## 📞 Soporte

Si tienes problemas:
1. Revisa los logs del servidor
2. Verifica todas las variables de entorno
3. Prueba cada componente por separado
4. Consulta la documentación oficial de cada API

---

## 🎉 ¡Listo!

Una vez completados todos los pasos, tendrás:
- ✅ Bot de Telegram funcionando
- ✅ Integración con Google Sheets
- ✅ Dashboard web para gestión
- ✅ Sistema completo de pedidos

¡Tu sistema de distribuidora está listo para usar!