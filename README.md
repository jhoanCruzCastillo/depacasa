# PropScraper — Sistema de Web Scraping Inmobiliario

Proyecto de administración y extracción de datos inmobiliarios con web scraping avanzado.

## 🚀 Inicio Rápido

### Requisitos previos

- Docker y Docker Compose
- Python 3.11+ (para desarrollo local sin Docker)
- Node.js 18+ (para desarrollo local sin Docker)
- Ports disponibles: 5432 (PostgreSQL), 6379 (Redis), 8000 (Backend), 3000 (Frontend)

### Con Docker Compose (Recomendado)

```bash
# 1. Clonar el repositorio
cd dron

# 2. Crear archivo .env en la raíz
cp .env.example .env

# 3. Levanta todos los servicios
docker-compose up -d

# 4. Crear las tablas de la base de datos
docker-compose exec backend alembic upgrade head

# 5. Acceder a la aplicación
# - Frontend: http://localhost:3000
# - Backend API: http://localhost:8000
# - Docs API: http://localhost:8000/docs
```

### Desarrollo local

#### Backend

```bash
cd backend

# Crear entorno virtual
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Instalar dependencias
pip install -r requirements.txt

# Variables de entorno
cp .env.example .env

# Iniciar servidor
uvicorn main:app --reload
```

#### Frontend

```bash
cd frontend

# Instalar dependencias
npm install

# Variables de entorno
cp .env.example .env

# Iniciar servidor de desarrollo
npm run dev
```

## 📁 Estructura del Proyecto

```
dron/
├── backend/                 # API FastAPI
│   ├── app/
│   │   ├── models/         # Modelos SQLAlchemy
│   │   ├── schemas/        # Schemas Pydantic
│   │   ├── services/       # Lógica de negocio
│   │   ├── routers/        # Endpoints FastAPI
│   │   └── workers/        # Tareas Celery
│   ├── migrations/         # Migraciones Alembic
│   ├── main.py            # Aplicación FastAPI
│   ├── config.py          # Configuración
│   ├── database.py        # Conexión BD
│   ├── requirements.txt
│   └── Dockerfile
│
├── frontend/               # UI React + TypeScript
│   ├── src/
│   │   ├── components/    # Componentes React
│   │   ├── pages/         # Páginas
│   │   ├── services/      # Cliente API
│   │   ├── store/         # Estado global (Zustand)
│   │   ├── hooks/         # Custom hooks
│   │   ├── types/         # TypeScript types
│   │   └── App.tsx
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── Dockerfile
│
├── docker-compose.yml     # Orquestación de servicios
├── .env.example          # Variables de entorno
└── README.md             # Este archivo
```

## 🔌 API Endpoints

### Desarrolladoras
- `GET /api/developers` - Listar todas
- `POST /api/developers` - Crear nueva
- `GET /api/developers/{id}` - Obtener una
- `PUT /api/developers/{id}` - Actualizar
- `DELETE /api/developers/{id}` - Eliminar

### Plantillas (URL Nodes, Fields, Selectors)
- `GET /api/templates/developers/{id}/url-nodes` - Listar nodos URL
- `POST /api/templates/url-nodes` - Crear nodo
- `GET /api/templates/url-nodes/{id}/fields` - Listar campos
- `POST /api/templates/fields` - Crear campo
- `GET /api/templates/fields/{id}/selectors` - Listar selectores
- `POST /api/templates/selectors` - Crear selector

### Scraping
- `POST /api/scrape/{developer_id}` - Iniciar scraping
- `GET /api/scrape/jobs/{job_id}` - Estado del trabajo
- `GET /api/scrape/developer/{id}/jobs` - Listar trabajos

### Búsqueda
- `GET /api/search/platforms?query=...` - Buscar plataformas (Tavily)
- `POST /api/search/verify-url?url=...` - Verificar URL

## 🗄️ Modelo de Datos

### Developer
- Desarrolladora inmobiliaria registrada
- Campos: id, name, description, base_url, logo_url, source (tavily/manual), created_at

### UrlNode
- Nodo en árbol recursivo (padre → hijo → nieta)
- Campos: id, developer_id, parent_id, name, url, order, created_at

### Field
- Campo a extraer de cada nodo
- Campos: id, url_node_id, name, is_child_url, order, created_at

### Selector
- Selector CSS en cadena descendente
- Campos: id, field_id, value, order, created_at

### ScrapedRecord
- Registro extraído de una URL
- Campos: id, developer_id, url_node_id, source_url, data (JSONB), status, scraped_at

### ScrapeJob
- Trabajo de scraping
- Campos: id, developer_id, status, started_at, finished_at, total_records, error_log, created_at

## 🔧 Configuración

### Variables de entorno (.env)

```env
# Database
DATABASE_URL=postgresql://proptech:proptech@localhost:5432/proptech_db

# Redis
REDIS_URL=redis://localhost:6379/0
CELERY_BROKER_URL=redis://localhost:6379/1
CELERY_RESULT_BACKEND=redis://localhost:6379/2

# Tavily API
TAVILY_API_KEY=

# Debug
DEBUG=True

# CORS
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
```

## 🧪 Testing

```bash
# Backend
cd backend
pytest

# Frontend
cd frontend
npm run test
```

## 📚 Documentación

- API Docs: http://localhost:8000/docs (Swagger UI)
- ReDoc: http://localhost:8000/redoc
- Documentación técnica: [PROPTECH_SCRAPER_DOC.md](./PROPTECH_SCRAPER_DOC.md)

## 🤝 Contribuir

1. Crear rama para feature: `git checkout -b feature/nueva-caracteristica`
2. Commit cambios: `git commit -am 'Añadir nueva característica'`
3. Push a la rama: `git push origin feature/nueva-caracteristica`
4. Abrir Pull Request

## 📝 Licencia

Proptech Scraper - 2024
