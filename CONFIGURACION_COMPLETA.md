# 🚀 Configuración Completa para Railway

## 📋 Pasos para Configurar Todo

### 1. **Google Sheets Setup**

#### Crear Google Sheet
1. Ve a [Google Sheets](https://sheets.google.com)
2. Crea nueva hoja: **"Sistema Distribuidora"**
3. Copia el ID de la URL: `https://docs.google.com/spreadsheets/d/[ESTE_ES_EL_ID]/edit`

#### Crear Pestañas
Crea estas 5 pestañas exactamente con estos nombres:
- `Clientes`
- `Categorias` 
- `Productos`
- `Pedidos`
- `DetallePedidos`

#### Agregar Encabezados

**Pestaña "Clientes":**
```
A1: cliente_id    B1: nombre
```

**Pestaña "Categorias":**
```
A1: categoria_id    B1: categoria_nombre
```

**Pestaña "Productos":**
```
A1: producto_id    B1: categoria_id    C1: producto_nombre    D1: precio    E1: activo
```

**Pestaña "Pedidos":**
```
A1: pedido_id    B1: fecha_hora    C1: cliente_id    D1: cliente_nombre    E1: items_cantidad    F1: total    G1: estado
```

**Pestaña "DetallePedidos":**
```
A1: detalle_id    B1: pedido_id    C1: producto_id    D1: producto_nombre    E1: categoria_id    F1: cantidad    G1: precio_unitario    H1: importe
```

### 2. **Google Cloud Console**

#### Crear Proyecto
1. Ve a [Google Cloud Console](https://console.cloud.google.com)
2. Crear nuevo proyecto: **"Sistema Distribuidora"**

#### Habilitar APIs
1. **APIs y servicios** → **Biblioteca**
2. Buscar y habilitar:
   - **Google Sheets API**
   - **Google Drive API**

#### Crear Cuenta de Servicio
1. **APIs y servicios** → **Credenciales**
2. **+ CREAR CREDENCIALES** → **Cuenta de servicio**
3. Nombre: `distribuidora-service`
4. Rol: **Editor**
5. **CREAR Y CONTINUAR**

#### Generar Clave JSON
1. Clic en la cuenta de servicio creada
2. **CLAVES** → **AGREGAR CLAVE** → **Crear clave nueva**
3. Tipo: **JSON**
4. **CREAR** (se descarga el archivo)

#### Compartir Google Sheet
1. Abrir tu Google Sheet
2. **Compartir**
3. Agregar el email de la cuenta de servicio (del JSON)
4. Permisos: **Editor**

### 3. **Bot de Telegram**

#### Crear Bot
1. Buscar **@BotFather** en Telegram
2. Enviar `/newbot`
3. Nombre: `Sistema Distribuidora Bot`
4. Username: `tu_distribuidora_bot`
5. **GUARDAR EL TOKEN**

#### Configurar Bot
```
/setdescription
Bot para gestión de pedidos de distribuidora

/setcommands
start - Iniciar nuevo pedido
ayuda - Ver comandos disponibles
pedidos - Ver mis pedidos
```

### 4. **Configurar Variables en Railway**

En el dashboard de Railway, agregar estas variables:

#### Variables Obligatorias
```env
NODE_ENV=production
JWT_SECRET=tu_clave_super_secreta_2024_railway
```

#### Variables de Google Sheets
```env
GOOGLE_SHEETS_ID=1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t
GOOGLE_SERVICE_ACCOUNT_EMAIL=distribuidora-service@tu-proyecto.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...
...tu clave privada completa aquí...
...
-----END PRIVATE KEY-----"
```

#### Variables de Telegram
```env
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ123456789
```

### 5. **Desplegar en Railway**

#### Subir a GitHub
```bash
git add .
git commit -m "Sistema completo para Railway"
git push origin main
```

#### Crear en Railway
1. [railway.app](https://railway.app) → **New Project**
2. **Deploy from GitHub repo**
3. Seleccionar tu repositorio
4. Railway detecta automáticamente Node.js

#### Configurar Variables
Agregar todas las variables del paso 4 en Railway

### 6. **Post-Deploy**

#### Configurar Webhook
Una vez desplegado, ejecutar:
```bash
curl -X POST "https://tu-app.railway.app/api/setup-webhook"
```

O manualmente:
```bash
curl -X POST "https://api.telegram.org/botTU_TOKEN/setWebhook" \
     -H "Content-Type: application/json" \
     -d '{"url": "https://tu-app.railway.app/webhook"}'
```

#### Poblar Google Sheets
Ejecutar el script de setup:
```bash
node scripts/create-sheets-data.js
```

### 7. **Verificar Todo**

#### URLs de tu aplicación:
- **Dashboard**: `https://tu-app.railway.app`
- **API Info**: `https://tu-app.railway.app/api/info`
- **Health Check**: `https://tu-app.railway.app/health`
- **Test Sheets**: `https://tu-app.railway.app/api/test/sheets`

#### Probar Bot
1. Buscar tu bot en Telegram
2. Enviar `/start`
3. Seguir el flujo de pedido

## 🔧 Datos de Ejemplo

### Clientes
```
1    Juan Pérez
2    María González  
3    Carlos Rodríguez
4    Ana Martínez
5    Luis Fernández
```

### Categorías
```
1    Galletitas
2    Bebidas
3    Lácteos
4    Panadería
5    Conservas
```

### Productos
```
1    1    Oreo Original 117g         450    SI
2    1    Pepitos Chocolate 100g     380    SI
3    2    Coca Cola 500ml            350    SI
4    3    Leche Entera 1L            280    SI
5    4    Pan Lactal 500g            320    SI
```

## 🎯 Resultado Final

✅ **Dashboard web completo**  
✅ **Bot de Telegram funcional**  
✅ **Integración Google Sheets**  
✅ **API REST completa**  
✅ **Gestión de pedidos en tiempo real**  
✅ **Estadísticas y reportes**  
✅ **Sistema escalable en Railway**  

## 🆘 Solución de Problemas

### Error: "The caller does not have permission"
- Verificar que compartiste la Google Sheet con la cuenta de servicio
- Revisar que el email de la cuenta de servicio sea correcto

### Error: "Webhook not found"
- Ejecutar `/api/setup-webhook` después del deploy
- Verificar que RAILWAY_STATIC_URL esté disponible

### Error: "Invalid token"
- Verificar que el token de Telegram sea correcto
- No debe tener espacios extra al inicio o final

### Bot no responde
- Verificar que el webhook esté configurado
- Revisar logs en Railway dashboard
- Probar el endpoint `/health`

¡Tu sistema estará completamente funcional siguiendo estos pasos!