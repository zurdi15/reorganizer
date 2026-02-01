# File Reorganizer 📁

Herramienta web para organizar automáticamente fotos y videos en una estructura jerárquica basada en tipo de archivo, orientación y dispositivo.

## 🎯 ¿Qué hace?

Organiza tus archivos multimedia de forma inteligente:

- **🖼️ Fotos y 🎞️ Videos**: Detecta y clasifica automáticamente
- **📐 Orientación**: Distingue horizontal vs vertical
- **📱 Dispositivo**: Identifica contenido de teléfono vs dron (DJI Mini 3)
- **🗂️ Estructura**: Crea carpetas organizadas por año/mes/país

## 🚀 Inicio Rápido

### Con Docker (Recomendado)

\`\`\`bash
docker build -t reorganizer .
docker run -p 3333:3333 \
  -e USER_ID=1000 \
  -v /ruta/a/archivos/entrada:/input \
  -v /ruta/a/archivos/salida:/output \
  reorganizer
\`\`\`

Abre tu navegador en: **http://localhost:3333**

### Sin Docker

**Requisitos**: Python 3.11+ y Node.js 20+

\`\`\`bash
# 1. Instalar dependencias
pip install -r requirements.txt
cd frontend && npm install && cd ..

# 2. Construir frontend
cd frontend && npm run build && cd ..

# 3. Ejecutar servidor
python3 backend/server.py
\`\`\`

Abre tu navegador en: **http://localhost:3333**

## 📖 Cómo Usar

### Interfaz Web

1. **Archivos de entrada**: La aplicación muestra automáticamente los archivos encontrados en \`/input\`
   - 🖼️ Fotos (JPG, PNG, HEIC, etc.)
   - 🎞️ Videos (MP4, MOV, AVI, etc.)

2. **Ruta de salida**: Especifica dónde organizar los archivos
   - Formato: \`año/mes/ubicación\` (ej: \`2024/08/croatia\`)
   - El explorador de carpetas muestra las rutas disponibles
   - Puedes navegar por carpetas haciendo clic

3. **Organizar**: Haz clic en "Organize Files"
   - Verás el progreso en tiempo real
   - Estadísticas actualizadas: fotos, videos, errores
   - Logs detallados de cada archivo procesado

### Estructura de Salida

Los archivos se organizan automáticamente:

\`\`\`
/output/
└── 2024/
    └── 08/
        └── croatia/
            ├── photo/
            │   ├── imagen1.jpg
            │   └── imagen2.png
            └── video/
                ├── horizontal/
                │   ├── phone/
                │   │   └── video1.mp4
                │   └── dron/
                │       └── mini3/
                │           └── aereo1.mp4
                └── vertical/
                    ├── phone/
                    │   └── video2.mp4
                    └── dron/
                        └── mini3/
                            └── aereo2.mp4
\`\`\`

## ⚙️ Configuración

### Variables de Entorno

Crea un archivo \`backend/.env\`:

\`\`\`bash
# Carpetas de trabajo
INPUT=/input           # Carpeta con archivos a organizar
OUTPUT=/output         # Carpeta donde se organizarán

# Permisos (para Docker)
USER_ID=1000          # ID del usuario propietario de los archivos

# Puerto del servidor
DEV_PORT=3333         # Puerto web (default: 3333)
\`\`\`

### Volúmenes Docker

Monta tus carpetas locales:

\`\`\`bash
-v /home/usuario/Descargas:/input          # Archivos a organizar
-v /home/usuario/Fotos:/output             # Destino organizado
\`\`\`

## 🔧 Herramienta CLI

También puedes usar la herramienta desde línea de comandos:

\`\`\`bash
# Organizar archivos manualmente
export USER_ID=1000
python3 backend/cli.py --year 2024 --path croatia

# Con mes específico
python3 backend/cli.py --year 2024 --month 08 --path croatia/split
\`\`\`

El CLI organiza los archivos del \`/input\` configurado y crea la estructura en \`/output/año/mes/path\`.

## ❓ Preguntas Frecuentes

### ¿Qué tipos de archivo soporta?

- **Fotos**: JPG, JPEG, PNG, HEIC, HEIF, BMP, TIFF, WebP
- **Videos**: MP4, MOV, AVI, MKV, FLV, WMV, M4V, 3GP

### ¿Cómo detecta la orientación?

Lee los metadatos del video (ancho vs alto) para determinar si es horizontal (landscape) o vertical (portrait).

### ¿Cómo reconoce drones DJI?

Busca patrones en el nombre del archivo (ej: \`DJI_\`, \`MINI3_\`) y metadatos EXIF del dispositivo.

### ¿Qué pasa con archivos no reconocidos?

Se copian a una carpeta \`unknown/\` dentro de la ruta especificada, sin eliminarlos del origen.

### ¿Los archivos se mueven o se copian?

Por defecto se **mueven** (se eliminan del origen). Los archivos originales desaparecen de \`/input\`.

### ¿Puedo cancelar una operación en curso?

Actualmente no. La operación se completa una vez iniciada. Cierra el navegador si es necesario, pero algunos archivos ya habrán sido movidos.

## 🎨 Características de la Interfaz

- **🌙 Tema Oscuro**: Diseño moderno con colores oscuros
- **⚡ Tiempo Real**: Actualizaciones WebSocket sin recargar
- **📊 Estadísticas en Vivo**: Contador de archivos procesados
- **🔍 Explorador de Carpetas**: Navega por la estructura existente
- **📱 Responsive**: Funciona en móvil, tablet y escritorio
- **📋 Logs Detallados**: Ve el procesamiento de cada archivo

## 📄 Licencia

Uso personal. Ver [LICENSE](LICENSE) para más detalles.

---

Para instrucciones de desarrollo, consulta [DEVELOPER_README.md](DEVELOPER_README.md)
