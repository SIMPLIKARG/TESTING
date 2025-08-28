# 📊 Archivos CSV para Google Sheets

## 🎯 Archivos Listos para Cargar

Estos archivos están listos para cargar directamente a Google Sheets:

### **📁 Archivos incluidos:**
- **`clientes.csv`** - 15 clientes con nombres argentinos
- **`categorias.csv`** - 10 categorías de productos
- **`productos.csv`** - 46 productos con precios realistas
- **`pedidos.csv`** - 10 pedidos de ejemplo
- **`detallepedidos.csv`** - 24 líneas de detalle

## 🚀 **Cómo cargar a Google Sheets:**

### **Método 1: Crear Google Sheet desde cero**
1. Ve a [sheets.google.com](https://sheets.google.com)
2. Crear **Hoja de cálculo en blanco**
3. Nombrar: **"Sistema Distribuidora"**
4. Crear 5 pestañas con estos nombres exactos:
   - `Clientes`
   - `Categorias`
   - `Productos`
   - `Pedidos`
   - `DetallePedidos`

### **Método 2: Importar cada CSV**
Para cada pestaña:
1. **Archivo** → **Importar**
2. **Subir** → Seleccionar el archivo CSV correspondiente
3. **Tipo de importación**: "Reemplazar hoja de cálculo"
4. **Tipo de separador**: "Detectar automáticamente"
5. **Convertir texto a números**: ✅ Sí
6. **Importar datos**

### **Método 3: Copiar y pegar**
1. Abrir cada archivo CSV en un editor de texto
2. Seleccionar todo (Ctrl+A)
3. Copiar (Ctrl+C)
4. En Google Sheets, ir a la pestaña correspondiente
5. Pegar en la celda A1 (Ctrl+V)

## 📋 **Estructura de Datos:**

### **Clientes (15 registros)**
```
cliente_id | nombre
1          | Juan Pérez
2          | María González
...
```

### **Categorías (10 registros)**
```
categoria_id | categoria_nombre
1           | Galletitas
2           | Bebidas
...
```

### **Productos (46 registros)**
```
producto_id | categoria_id | producto_nombre      | precio | activo
1          | 1           | Oreo Original 117g   | 450    | SI
2          | 1           | Pepitos Chocolate    | 380    | SI
...
```

### **Pedidos (10 registros)**
```
pedido_id | fecha_hora          | cliente_id | cliente_nombre | items_cantidad | total | estado
PED001    | 2024-01-15 10:30:00 | 1         | Juan Pérez     | 3             | 1180  | CONFIRMADO
...
```

### **Detalle Pedidos (24 registros)**
```
detalle_id | pedido_id | producto_id | producto_nombre    | categoria_id | cantidad | precio_unitario | importe
DET001     | PED001    | 1          | Oreo Original 117g | 1           | 2        | 450            | 900
...
```

## 💰 **Precios en Pesos Argentinos (2024):**
- **Galletitas**: $280 - $450
- **Bebidas**: $180 - $420
- **Lácteos**: $150 - $520
- **Panadería**: $280 - $520
- **Conservas**: $250 - $420
- **Snacks**: $180 - $320
- **Dulces**: $80 - $450
- **Limpieza**: $150 - $320
- **Higiene**: $180 - $450
- **Congelados**: $380 - $650

## ✅ **Después de cargar:**
1. Copiar el ID de la Google Sheet (de la URL)
2. Configurar las credenciales de Google Cloud
3. Compartir la hoja con la cuenta de servicio
4. Configurar las variables de entorno en Railway

¡Tus datos están listos para usar con el sistema completo!