# Developer README 👨‍💻

Guía para desarrolladores que quieran contribuir o modificar el proyecto.

## 🏗️ Stack Técnico

### Frontend
- **Framework**: Vue 3 (Composition API + `<script setup>`)
- **TypeScript**: Strict mode
- **Build**: Vite 7.3.1
- **Estilos**: Tailwind CSS v4
- **Estado**: Pinia stores
- **Testing**: Vitest + @vue/test-utils
- **Real-time**: WebSocket composable

### Backend
- **Framework**: FastAPI
- **Server**: Uvicorn
- **Python**: 3.11+
- **Clasificación**: PIL + OpenCV
- **Permisos**: Subprocess (sudo chown)

## 🚀 Setup de Desarrollo

### 1. Clonar y preparar entorno

```bash
git clone <repo>
cd reorganizer
```

### 2. Backend

```bash
# Instalar dependencias Python
pip install -r requirements.txt

# Configurar variables de entorno
cd backend
cp .env.example .env  # Si existe, sino crear .env
nano .env

# Contenido del .env:
INPUT=/ruta/absoluta/input
OUTPUT=/ruta/absoluta/output
USER_ID=1000
DEV_PORT=3334
```

**Ejecutar servidor:**

```bash
python3 backend/server.py
```

El backend corre en **http://localhost:3334**

### 3. Frontend

```bash
cd frontend

# Instalar dependencias
npm install

# Ejecutar en modo desarrollo
npm run dev
```

El frontend corre en **http://localhost:5173** con:
- ✅ Hot Module Replacement (HMR)
- ✅ CORS habilitado
- ✅ Requests directas a localhost:3334

### 4. Crear carpetas de prueba (opcional)

```bash
mkdir -p fs_mock/input fs_mock/output

# Copiar archivos de prueba a fs_mock/input
# Actualizar .env:
INPUT=/ruta/absoluta/a/reorganizer/fs_mock/input
OUTPUT=/ruta/absoluta/a/reorganizer/fs_mock/output
```

## 📁 Estructura del Proyecto

```
reorganizer/
├── backend/                      # 🐍 Backend Python
│   ├── .env                      # Config (no commitear)
│   ├── __init__.py
│   ├── server.py                 # FastAPI app
│   ├── cli.py                    # Herramienta CLI
│   └── shared.py                 # Lógica compartida
│
├── frontend/                     # 🎨 Frontend Vue 3
│   ├── src/
│   │   ├── App.vue              # Componente raíz
│   │   ├── main.ts              # Entry point
│   │   │
│   │   ├── components/          # 6 componentes
│   │   │   ├── FileList.vue         # Lista de archivos input
│   │   │   ├── FilePreview.vue      # Preview flotante
│   │   │   ├── LogViewer.vue        # Logs de procesamiento
│   │   │   ├── OrganizeForm.vue     # Botón organizar
│   │   │   ├── OutputPathInput.vue  # Selector de ruta
│   │   │   └── ProcessingStats.vue  # Estadísticas
│   │   │
│   │   ├── stores/              # 5 Pinia stores
│   │   │   ├── fileStore.ts         # Archivos input
│   │   │   ├── pathStore.ts         # Ruta output
│   │   │   ├── previewStore.ts      # Preview estado
│   │   │   ├── processingStore.ts   # Estadísticas procesamiento
│   │   │   └── wsStore.ts           # WebSocket estado
│   │   │
│   │   ├── composables/         # Composables
│   │   │   └── useWebSocket.ts      # WebSocket singleton
│   │   │
│   │   ├── types/               # TypeScript types
│   │   │   └── index.ts
│   │   │
│   │   ├── assets/              # Estilos globales
│   │   │   └── tailwind.css
│   │   │
│   │   └── __tests__/           # 35 tests unitarios
│   │       ├── components/
│   │       ├── stores/
│   │       └── composables/
│   │
│   ├── public/                  # Assets estáticos
│   │   └── logo.svg
│   │
│   ├── dist/                    # Build output (generado)
│   ├── vite.config.ts           # Config Vite
│   ├── vitest.config.ts         # Config tests
│   ├── tailwind.config.js       # Config Tailwind
│   ├── tsconfig.json            # TypeScript config
│   └── package.json
│
├── fs_mock/                     # Para testing local
│   ├── input/
│   └── output/
│
├── Dockerfile                   # Multi-stage build
├── requirements.txt             # Dependencias Python
├── README.md                    # Manual de usuario
└── DEVELOPER_README.md          # Este archivo
```

## 🔧 Desarrollo

### Workflow Recomendado

**Terminal 1 - Backend:**
```bash
python3 backend/server.py
# Backend con auto-reload en cambios
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
# HMR activo - cambios instantáneos
```

**Terminal 3 - Tests (opcional):**
```bash
cd frontend
npm test
# Vitest en modo watch
```

### Hot Reload

- **Backend**: Reinicia manualmente el servidor tras cambios en `.py`
- **Frontend**: HMR automático (cambios instantáneos en `.vue`, `.ts`)

### CORS en Desarrollo

El frontend hace requests directas a `http://localhost:3334` con CORS habilitado:

```typescript
// frontend/src/stores/fileStore.ts
const baseUrl = import.meta.env.DEV ? 'http://localhost:3334' : ''
```

El backend tiene CORS configurado:

```python
# backend/server.py
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

## 🧪 Testing

### Ejecutar tests

```bash
cd frontend

# Modo watch (recomendado)
npm test

# UI gráfica
npm test:ui

# Una sola vez
npm run test:run

# Con cobertura
npm test:coverage
```

### Tests actuales

- ✅ **35 tests** - 100% pass rate
- **Componentes**: 6 suites
- **Stores**: 5 suites  
- **Composables**: 1 suite

### Escribir nuevos tests

```typescript
// frontend/src/__tests__/components/MiComponente.spec.ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import MiComponente from '@/components/MiComponente.vue'

describe('MiComponente', () => {
  it('renders correctly', () => {
    const wrapper = mount(MiComponente)
    expect(wrapper.text()).toContain('Texto esperado')
  })
})
```

## 📦 Build de Producción

### Frontend

```bash
cd frontend
npm run build

# Output en frontend/dist/
# - index.html
# - assets/*.js (bundled & minified)
# - assets/*.css (bundled & minified)
```

### Backend sirve el frontend

El servidor FastAPI sirve automáticamente `/frontend/dist/`:

```python
# backend/server.py
FRONTEND_DIST = os.path.join(PROJECT_ROOT, "frontend", "dist")
app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")))

@app.get("/", response_class=HTMLResponse)
def read_root():
    index_path = os.path.join(FRONTEND_DIST, "index.html")
    with open(index_path, "r") as f:
        return f.read()
```

### Docker

```bash
# Build multi-stage
docker build -t reorganizer:latest .

# Stages:
# 1. node:20 - npm install + build frontend
# 2. python:3.11-slim - pip install + copy frontend/dist
```

## 🔌 API Endpoints

### REST API

- `GET /api/input` - Lista archivos en INPUT_PATH
- `GET /api/output?subfolder=` - Lista carpetas en OUTPUT_PATH/subfolder
- `GET /media/{filename}` - Sirve archivo estático de INPUT_PATH

### WebSocket

- `WS /ws/reorganizer` - Procesamiento con updates en tiempo real

**Mensajes del cliente:**
```json
{ "path": "2024/08/croatia" }
```

**Mensajes del servidor:**
```
event-total:50
event-processed-pictures:10
event-processed-videos:5
event-processed:File: <b>IMG_123.jpg</b>...
event-complete
```

## 🎨 Estilos y Tema

### Tailwind CSS v4

```css
/* frontend/src/assets/tailwind.css */
@import "tailwindcss";

/* Custom utilities */
@utility btn-primary { ... }
@utility input-base { ... }
@utility card { ... }
```

### Colores del tema

- **Primario**: Amber (naranja) - `bg-amber-600`, `text-amber-400`
- **Fondos**: Gray 800/900 - `bg-gray-800/90`, `bg-gray-900`
- **Texto**: White/Gray 300 - `text-white`, `text-gray-300`
- **Bordes**: Gray 700 - `border-gray-700`

### Scrollbars personalizados

```css
.scrollbar-thin::-webkit-scrollbar {
  width: 8px;
}
.scrollbar-thin::-webkit-scrollbar-track {
  @apply bg-gray-800;
}
.scrollbar-thin::-webkit-scrollbar-thumb {
  @apply bg-gray-600 rounded;
}
```

## 🐛 Debugging

### Backend

```python
# Agregar prints en backend/server.py
print(f"Processing file: {file_name}")
```

### Frontend

```typescript
// En componentes Vue
console.log('Estado actual:', toRaw(store.files))

// En stores
console.log('Fetch result:', data)
```

### Network

Abrir DevTools (F12) → Network tab:
- Ver requests a `/api/input`, `/api/output`
- Ver WebSocket frames en `/ws/reorganizer`

## 🚧 Problemas Conocidos

### Permisos sudo

El cambio de propiedad (`chown`) requiere permisos sudo:

```python
# backend/shared.py - Falla silenciosamente en dev
subprocess.run(['sudo', '-n', 'chown', '-R', f'{user_id}:{user_id}', path])
```

**Solución dev**: Ejecutar sin `USER_ID` o configurar sudoers NOPASSWD.

**Solución producción**: Docker con USER_ID configurado.

### Archivos grandes

Archivos >100MB pueden tardar en procesarse. El WebSocket muestra progreso pero no hay cancelación implementada.

## 📚 Recursos

- **Vue 3**: https://vuejs.org/
- **Pinia**: https://pinia.vuejs.org/
- **Vite**: https://vitejs.dev/
- **Tailwind CSS**: https://tailwindcss.com/
- **FastAPI**: https://fastapi.tiangolo.com/
- **Vitest**: https://vitest.dev/

## 🤝 Contribuir

1. Fork el proyecto
2. Crea una rama: `git checkout -b feature/nueva-feature`
3. Commit cambios: `git commit -m 'Add nueva feature'`
4. Push: `git push origin feature/nueva-feature`
5. Abre un Pull Request

### Convenciones

- **Commits**: Mensajes claros en inglés
- **Código**: TypeScript strict, ESLint auto-fix
- **Tests**: Agregar tests para nuevas features
- **Estilos**: Usar Tailwind utilities, evitar CSS inline
