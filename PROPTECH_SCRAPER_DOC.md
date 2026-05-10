# PropScraper — Sistema de Web Scraping Inmobiliario
> Documentación técnica completa para desarrollo con agente de IA

---

## 1. Visión General del Proyecto

**PropScraper** es un sistema de administración y extracción de datos inmobiliarios. Permite registrar plataformas inmobiliarias (desarrolladoras), configurar plantillas de extracción visual basadas en selectores DOM, y ejecutar scrapers automáticos que recorren estructuras de URLs de manera recursiva (padre → hija → nieta, etc.).

El sistema no requiere autenticación. Se accede directamente al panel de administración.

### Objetivos principales

- Centralizar el monitoreo de múltiples plataformas inmobiliarias en un solo panel.
- Permitir configurar la extracción de datos sin escribir código, usando selectores CSS (etiquetas, clases, IDs).
- Soportar scrapers tanto en sitios HTML estático como en SPAs (Single Page Applications con JavaScript).
- Usar Tavily para descubrir nuevas plataformas inmobiliarias.
- Permitir también el registro manual de desarrolladoras.

---

## 2. Stack Tecnológico

### Backend

| Tecnología | Uso |
|---|---|
| **Python 3.11+** | Lenguaje principal del backend |
| **FastAPI** | Framework REST API |
| **SQLAlchemy 2.x** | ORM para acceso a base de datos |
| **Alembic** | Migraciones de base de datos |
| **Playwright (Python)** | Scraping de páginas HTML estáticas y SPAs |
| **Tavily Python SDK** | Búsqueda de plataformas inmobiliarias |
| **Celery + Redis** | Cola de tareas para ejecutar scrapers en background |
| **PostgreSQL 15+** | Base de datos principal |
| **Pydantic v2** | Validación de datos y schemas |
| **python-dotenv** | Manejo de variables de entorno |
| **httpx** | Cliente HTTP async para pruebas de conectividad |

### Frontend

| Tecnología | Uso |
|---|---|
| **React 18+** | Framework UI |
| **TypeScript** | Tipado estático |
| **Vite** | Build tool |
| **Tailwind CSS v3** | Estilos utilitarios |
| **React Query (TanStack Query)** | Fetching, caché y sincronización de datos |
| **Zustand** | Estado global del cliente |
| **React Router v6** | Navegación SPA |
| **Axios** | Cliente HTTP |
| **Lucide React** | Iconografía |
| **React Hot Toast** | Notificaciones |

### Infraestructura / DevOps

| Tecnología | Uso |
|---|---|
| **Docker + Docker Compose** | Contenedores para dev y producción |
| **Redis** | Broker de tareas Celery y caché |
| **Nginx** | Proxy reverso para producción |

---

## 3. Arquitectura del Sistema

```
┌─────────────────────────────────────────────────────────┐
│                     FRONTEND (React)                    │
│   Panel Admin → Desarrolladoras / Plantillas de         │
│   Extracción                                            │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP REST (JSON)
┌────────────────────────▼────────────────────────────────┐
│                   BACKEND (FastAPI)                     │
│  Routers: developers / templates / scrape / search      │
│  Services: TavilyService / ScraperService /             │
│            TemplateService                              │
└───────┬────────────────┬────────────────────────────────┘
        │                │
┌───────▼──────┐  ┌──────▼──────────────────────────────┐
│  PostgreSQL  │  │   Celery Worker                     │
│  (datos y    │  │   - Playwright lanza el scraper      │
│   plantillas)│  │   - Recorre árbol URL recursivamente │
└──────────────┘  └──────────────────────────────────────┘
                         │
                  ┌──────▼──────┐
                  │    Redis    │
                  │  (broker +  │
                  │   caché)    │
                  └─────────────┘
```

---

## 4. Modelo de Datos

### Entidades y relaciones

```
Developer (Desarrolladora)
├── id: UUID
├── name: str
├── description: str
├── base_url: str
├── logo_url: str (opcional)
├── source: enum ['tavily', 'manual']
└── created_at: datetime

UrlNode (Nodo URL — árbol recursivo)
├── id: UUID
├── developer_id: UUID → Developer
├── parent_id: UUID → UrlNode (NULL si es raíz)
├── name: str  (ej: "Proyectos", "Departamentos")
├── url: str
├── order: int (para ordenar tabs/secciones)
└── created_at: datetime

Field (Campo a extraer)
├── id: UUID
├── url_node_id: UUID → UrlNode
├── name: str  (ej: "precio", "ubicacion", "area")
├── is_child_url: bool  (indica si este campo es una URL hija)
└── order: int

Selector (Paso del selector DOM — cadena descendente)
├── id: UUID
├── field_id: UUID → Field
├── value: str  (ej: "div.container-precio", "#span-precio", "span")
└── order: int  (define la jerarquía descendente)

ScrapedRecord (Registro extraído)
├── id: UUID
├── developer_id: UUID → Developer
├── url_node_id: UUID → UrlNode
├── source_url: str  (URL exacta donde se extrajo)
├── data: JSONB  (campos dinámicos extraídos)
├── scraped_at: datetime
└── status: enum ['success', 'partial', 'failed']

ScrapeJob (Tarea de scraping)
├── id: UUID
├── developer_id: UUID → Developer
├── status: enum ['pending', 'running', 'completed', 'failed']
├── started_at: datetime
├── finished_at: datetime
├── total_records: int
└── error_log: text
```

### Notas sobre el modelo

- `UrlNode` es **auto-referencial**: un nodo puede tener un `parent_id` apuntando a otro nodo. Esto permite el árbol ilimitado de URLs.
- `Field.is_child_url = true` indica que el valor extraído de ese campo es la URL para navegar al siguiente nodo hijo.
- `ScrapedRecord.data` es JSONB, lo que permite guardar cualquier conjunto de campos dinámicos sin alterar el schema.
- `Selector.order` define el orden descendente de la cadena de selectores (el primero es el más externo, el último es el que contiene el valor).

---

## 5. Casos de Uso

### CU-01: Buscar Plataforma Inmobiliaria (Tavily)

**Actor:** Administrador  
**Precondición:** El administrador está en la sección "Plantillas de Extracción"  
**Flujo principal:**
1. El admin escribe el nombre o tipo de inmobiliaria en el buscador.
2. El frontend llama a `GET /api/search/developers?q={query}`.
3. El backend invoca la API de Tavily con la query.
4. Tavily devuelve resultados con nombre, URL y descripción de plataformas.
5. El backend compara los resultados con los developers ya registrados en BD.
6. El frontend muestra los resultados en cards indicando cuáles ya están registrados (badge "Ya agregado").

**Postcondición:** El admin puede ver resultados y seleccionar cuáles agregar.

---

### CU-02: Agregar Desarrolladora desde Búsqueda Tavily

**Actor:** Administrador  
**Precondición:** El admin ha realizado una búsqueda (CU-01) y hay resultados no registrados.  
**Flujo principal:**
1. El admin marca con checkboxes las plataformas que quiere agregar (hay botón "Todos / Ninguno").
2. El admin confirma con el botón "Agregar seleccionadas".
3. El frontend llama a `POST /api/developers/bulk` con la lista de plataformas seleccionadas.
4. El backend crea registros `Developer` para cada una.
5. El frontend muestra las nuevas cards en el catálogo de desarrolladoras (lado derecho de la sección).
6. Las nuevas desarrolladoras también aparecen en la sección "1. Desarrolladoras".

**Postcondición:** Las plataformas quedan registradas en BD con nombre, URL base y descripción de Tavily.

---

### CU-03: Agregar Desarrolladora Manualmente

**Actor:** Administrador  
**Precondición:** El admin está en la sección "Plantillas de Extracción".  
**Flujo principal:**
1. El admin hace clic en "Agregar manualmente".
2. Se abre un modal con campos: Nombre, URL base, Descripción.
3. El admin completa y confirma.
4. El frontend llama a `POST /api/developers` con los datos.
5. El backend crea el registro `Developer`.
6. La nueva card aparece en el catálogo.

**Postcondición:** Developer creado sin pasar por Tavily.

---

### CU-04: Ver Catálogo de Desarrolladoras

**Actor:** Administrador  
**Precondición:** Existen developers registrados.  
**Flujo principal:**
1. El admin navega a la sección "1. Desarrolladoras".
2. El frontend llama a `GET /api/developers`.
3. Se muestran cards con: nombre, descripción, URL base.
4. Hay buscador y paginación en la parte inferior.

**Postcondición:** El admin puede visualizar todas las plataformas registradas.

---

### CU-05: Gestionar Desarrolladora (Ver Datos Scrapeados)

**Actor:** Administrador  
**Precondición:** El developer tiene plantilla configurada y scraping ejecutado.  
**Flujo principal:**
1. El admin hace clic en "Gestionar" en una card de developer.
2. El frontend llama a `GET /api/developers/{id}` y `GET /api/developers/{id}/url-nodes`.
3. El header muestra el nombre y descripción editables.
4. Se generan **tabs dinámicos** por cada `UrlNode` del developer (uno por nodo).
5. Al seleccionar un tab, se llama a `GET /api/developers/{id}/records?node_id={node_id}`.
6. Los registros se muestran como cards con un botón "Ver más" para expandir todos los campos scrapeados.

**Postcondición:** El admin visualiza los datos extraídos organizados por sección (UrlNode).

---

### CU-06: Configurar Plantilla de Extracción

**Actor:** Administrador  
**Precondición:** El developer está registrado.  
**Flujo principal:**
1. El admin hace clic en "Gestionar" en una card del catálogo dentro de "Plantillas de Extracción".
2. El frontend carga el editor de plantilla y llama a `GET /api/developers/{id}/template`.
3. El editor muestra:
   - **Input "Nombre de sección"**: nombre del UrlNode raíz (ej: "Proyectos").
   - **Input "URL"**: URL desde donde se extraerá la lista de items.
   - **Lista de campos**: campos configurados para ese nodo.
4. El admin agrega campos con el botón "+ Agregar campo".
5. Por cada campo el admin:
   a. Escribe el nombre del campo (ej: "precio").
   b. Agrega selectores en cadena descendente (ej: `div.card-precio` → `span.monto`).
   c. Opcionalmente marca "Es URL hija" si el valor de ese campo es un enlace a otra página.
6. Si un campo se marca como URL hija, **se habilita un botón** "Agregar sección hija".
7. Al hacer clic se crea una nueva sección debajo (nuevo UrlNode hijo) con la misma estructura: nombre, URL (en este caso será el campo dinámico), y sus propios campos.
8. Este proceso es **recursivo e ilimitado**.
9. El admin guarda con "Guardar plantilla" → `POST /api/developers/{id}/template`.

**Postcondición:** La plantilla queda guardada en BD como árbol de UrlNodes y Fields con sus Selectors.

---

### CU-07: Ejecutar Scraping

**Actor:** Administrador  
**Precondición:** La plantilla de extracción está configurada.  
**Flujo principal:**
1. El admin hace clic en "Guardar y Ejecutar" en el editor de plantilla.
2. El frontend llama a `POST /api/scrape/{developer_id}/run`.
3. El backend guarda la plantilla y encola una tarea Celery.
4. El worker de Celery ejecuta el scraper con Playwright:
   a. Abre la URL del UrlNode raíz.
   b. Espera a que cargue el contenido (soporte SPA: `wait_for_load_state("networkidle")`).
   c. Por cada item encontrado, recorre la cadena de selectores de cada campo.
   d. Guarda el registro en `ScrapedRecord` con `data` JSONB.
   e. Si algún campo tiene `is_child_url=true`, toma las URLs extraídas y **repite el proceso recursivamente** para el UrlNode hijo correspondiente.
5. El job actualiza su estado en `ScrapeJob` (pending → running → completed/failed).
6. El frontend hace polling a `GET /api/scrape/jobs/{job_id}` para mostrar el progreso.

**Postcondición:** Los registros extraídos quedan en `ScrapedRecord` y son visibles en la sección "1. Desarrolladoras" bajo los tabs correspondientes.

---

### CU-08: Ver Estado del Scraping

**Actor:** Administrador  
**Precondición:** Se ha ejecutado al menos un scraping.  
**Flujo principal:**
1. Mientras el scraper corre, el frontend muestra un indicador de progreso en tiempo real (polling cada 3 segundos).
2. Se muestra: estado actual, registros procesados hasta el momento, errores si los hay.
3. Al finalizar, se notifica al admin con un toast de éxito o error.

---

### CU-09: Editar Nombre y Descripción de Desarrolladora

**Actor:** Administrador  
**Precondición:** El admin está en la vista de gestión de un developer.  
**Flujo principal:**
1. El nombre y descripción en el header son editables inline.
2. Al salir del campo o hacer clic en guardar, el frontend llama a `PATCH /api/developers/{id}`.

**Postcondición:** Los datos del developer quedan actualizados.

---

## 6. Endpoints REST (FastAPI)

### Developers

```
GET    /api/developers                    → Lista de developers (paginado, filtros)
POST   /api/developers                    → Crear developer manual
POST   /api/developers/bulk               → Crear múltiples developers desde Tavily
GET    /api/developers/{id}               → Detalle de un developer
PATCH  /api/developers/{id}              → Editar nombre/descripción
DELETE /api/developers/{id}              → Eliminar developer
GET    /api/developers/{id}/url-nodes     → Árbol de UrlNodes del developer
GET    /api/developers/{id}/records       → Registros scrapeados (filtro por node_id)
```

### Plantillas de Extracción

```
GET    /api/developers/{id}/template      → Obtener plantilla configurada
POST   /api/developers/{id}/template      → Guardar/reemplazar plantilla completa
```

### Scraping

```
POST   /api/scrape/{developer_id}/run     → Ejecutar scraper (encola tarea Celery)
GET    /api/scrape/jobs/{job_id}          → Estado del job en curso
GET    /api/scrape/{developer_id}/jobs    → Historial de jobs del developer
```

### Búsqueda (Tavily)

```
GET    /api/search/developers?q={query}   → Buscar plataformas inmobiliarias con Tavily
```

---

## 7. Lógica del Scraper (Playwright)

### Algoritmo recursivo

```python
async def scrape_node(page, url_node: UrlNode, parent_url: str = None):
    target_url = parent_url if url_node.url is None else url_node.url
    
    await page.goto(target_url)
    await page.wait_for_load_state("networkidle")  # Soporte SPA
    
    items = await extract_items(page, url_node.fields)
    
    for item in items:
        record = ScrapedRecord(
            developer_id=url_node.developer_id,
            url_node_id=url_node.id,
            source_url=target_url,
            data=item
        )
        db.save(record)
        
        # Procesar URLs hijas recursivamente
        for field in url_node.fields:
            if field.is_child_url and item.get(field.name):
                child_node = get_child_node(url_node, field)
                if child_node:
                    await scrape_node(page, child_node, item[field.name])

async def extract_items(page, fields: list[Field]) -> list[dict]:
    # Obtener todos los items del contenedor principal
    # Para cada field, recorrer la cadena de selectores
    # Retornar lista de dicts {campo: valor}
    ...
```

### Resolución de selectores

La cadena de selectores se recorre de forma flexible. No es necesario listar todos los nodos intermedios. El sistema construye un selector CSS compuesto y usa `page.query_selector_all()`:

```
Selectores definidos: ["div.card-proyecto", "div.precio-wrapper", "span.monto"]
→ Selector CSS resultante: "div.card-proyecto div.precio-wrapper span.monto"
→ Si no hay match, se prueba con each combinación descendente simplificada
```

**Tipos de selectores soportados:**

| Notación | Significado |
|---|---|
| `div.clase` | Tag con clase |
| `.clase` | Clase (cualquier tag) |
| `#id` | ID del elemento |
| `span` | Tag simple |
| `a` | Anchor (para URLs hija) |

---

## 8. Estructura del Proyecto

```
propscraper/
├── backend/
│   ├── app/
│   │   ├── main.py                  # Entry point FastAPI
│   │   ├── config.py                # Settings (env vars, keys)
│   │   ├── database.py              # SQLAlchemy engine y session
│   │   ├── models/
│   │   │   ├── developer.py
│   │   │   ├── url_node.py
│   │   │   ├── field.py
│   │   │   ├── selector.py
│   │   │   ├── scraped_record.py
│   │   │   └── scrape_job.py
│   │   ├── schemas/
│   │   │   ├── developer.py
│   │   │   ├── template.py
│   │   │   ├── scrape.py
│   │   │   └── search.py
│   │   ├── routers/
│   │   │   ├── developers.py
│   │   │   ├── templates.py
│   │   │   ├── scrape.py
│   │   │   └── search.py
│   │   ├── services/
│   │   │   ├── tavily_service.py    # Integración Tavily API
│   │   │   ├── scraper_service.py   # Lógica Playwright
│   │   │   └── template_service.py  # CRUD de plantillas
│   │   └── tasks/
│   │       └── scrape_task.py       # Tarea Celery
│   ├── alembic/                     # Migraciones
│   ├── requirements.txt
│   └── Dockerfile
│
├── frontend/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── DevelopersPage.tsx        # Sección 1
│   │   │   └── TemplatesPage.tsx         # Sección 2
│   │   ├── components/
│   │   │   ├── developers/
│   │   │   │   ├── DeveloperCard.tsx
│   │   │   │   ├── DeveloperDetail.tsx
│   │   │   │   └── DynamicTabs.tsx
│   │   │   ├── templates/
│   │   │   │   ├── SearchPanel.tsx        # Lado izquierdo (Tavily)
│   │   │   │   ├── DeveloperCatalog.tsx   # Lado derecho
│   │   │   │   ├── TemplateEditor.tsx     # Editor de plantilla
│   │   │   │   ├── UrlNodeEditor.tsx      # Editor de un nodo (recursivo)
│   │   │   │   ├── FieldEditor.tsx        # Editor de un campo
│   │   │   │   └── SelectorChain.tsx      # Cadena de selectores DOM
│   │   │   ├── scrape/
│   │   │   │   └── ScrapeProgress.tsx
│   │   │   └── ui/
│   │   │       ├── Card.tsx
│   │   │       ├── Modal.tsx
│   │   │       ├── Tabs.tsx
│   │   │       └── Badge.tsx
│   │   ├── hooks/
│   │   │   ├── useDevelopers.ts
│   │   │   ├── useTemplate.ts
│   │   │   ├── useScrape.ts
│   │   │   └── useTavilySearch.ts
│   │   ├── api/
│   │   │   └── client.ts             # Axios instance + endpoints
│   │   ├── store/
│   │   │   └── useAppStore.ts        # Zustand store
│   │   └── types/
│   │       └── index.ts              # TypeScript types globales
│   ├── package.json
│   ├── vite.config.ts
│   └── Dockerfile
│
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## 9. Variables de Entorno

```env
# Backend
DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/propscraper
REDIS_URL=redis://localhost:6379/0
TAVILY_API_KEY=tvly-xxxxxxxxxxxxxxxxxxxxxxxx

# Frontend
VITE_API_BASE_URL=http://localhost:8000
```

---

## 10. Docker Compose (Referencia)

```yaml
version: "3.9"
services:
  db:
    image: postgres:15
    environment:
      POSTGRES_DB: propscraper
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine

  backend:
    build: ./backend
    depends_on: [db, redis]
    env_file: .env
    ports:
      - "8000:8000"
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

  worker:
    build: ./backend
    depends_on: [db, redis]
    env_file: .env
    command: celery -A app.tasks worker --loglevel=info

  frontend:
    build: ./frontend
    ports:
      - "5173:5173"
    environment:
      - VITE_API_BASE_URL=http://backend:8000

volumes:
  pgdata:
```

---

## 11. Flujo UI Detallado

### Sección 1 — Desarrolladoras

```
/developers
├── Buscador interno + paginación
├── Grid de DeveloperCards
│   └── [Gestionar] →
│       /developers/{id}
│       ├── Header editable: nombre + descripción
│       └── Tabs dinámicos (uno por UrlNode)
│           └── Grid de ScrapedRecord cards
│               └── [Ver más] → expand todos los campos del JSONB
```

### Sección 2 — Plantillas de Extracción

```
/templates
├── Panel izquierdo (40%)
│   ├── Input de búsqueda
│   ├── [Buscar con Tavily]
│   ├── Resultados en cards con badge "Ya agregado" / checkboxes
│   ├── Botón "Todos / Ninguno"
│   ├── Botón "Agregar seleccionadas"
│   └── Botón "Agregar manualmente" → Modal
│
└── Panel derecho (60%)
    ├── Buscador de desarrolladoras registradas
    ├── Filtros (con/sin plantilla configurada, última ejecución)
    ├── Grid paginado de DeveloperCards
    └── [Gestionar] →
        /templates/{developer_id}/editor
        ├── Tabs: [Plantilla de extracción] [Propiedades] [Proyectos]
        └── Tab "Plantilla de extracción":
            UrlNodeEditor (raíz)
            ├── Input: Nombre de sección
            ├── Input: URL
            ├── Lista de FieldEditors
            │   ├── Input: nombre del campo
            │   ├── SelectorChain (lista de inputs para selectores)
            │   ├── Toggle: "Es URL hija"
            │   └── [Si es URL hija] → Botón "Agregar sección hija"
            │       └── UrlNodeEditor (hijo) — recursivo ↑
            ├── [+ Agregar campo]
            ├── [Guardar plantilla]
            └── [Guardar y Ejecutar] → ScrapeProgress modal
```

---

## 12. Consideraciones Importantes para el Agente

1. **`UrlNodeEditor` es un componente recursivo**: se renderiza a sí mismo para los nodos hijo. Usar un prop `depth` para controlar la indentación visual y evitar bucles infinitos en la UI.

2. **La plantilla se envía completa al backend** en una sola llamada al guardar. El backend reemplaza el árbol completo de `UrlNode` + `Field` + `Selector` del developer (delete + insert). Esto evita lógica de diff compleja.

3. **El scraper necesita manejar paginación** en las páginas de listado: muchas inmobiliarias tienen "Ver más" o paginación numérica. Para la versión inicial, scraping simple sin paginación automática. Dejar esta lógica preparada como extensión futura.

4. **Playwright debe correr en modo headless** dentro del worker Celery. Instalar dependencias del sistema en el Dockerfile del backend (`playwright install chromium --with-deps`).

5. **El polling del job** se hace desde el frontend cada 3 segundos hacia `GET /api/scrape/jobs/{job_id}`. Cuando el status cambia a `completed` o `failed`, detener el polling y notificar.

6. **Los tabs de la sección "Desarrolladoras"** se generan consultando los `UrlNode` del developer. El nombre del tab es `UrlNode.name`. El orden de los tabs es `UrlNode.order`, comenzando por el nodo raíz.

7. **Tavily retorna URLs y snippets**. El campo `url` de Tavily se usará como `base_url` del developer. El `content` o `snippet` de Tavily se usará como `description` inicial.

8. **CORS**: configurar FastAPI para aceptar requests del frontend en desarrollo (`http://localhost:5173`).

9. **Los selectores son flexibles**: el sistema construye un query CSS concatenando los selectores con espacio (descendiente), no con `>` (hijo directo), para mayor flexibilidad.

10. **Manejo de errores de scraping**: si un campo no se encuentra con la cadena de selectores, guardar `null` en ese campo del JSONB. No abortar el scraping completo.

---

## 13. Orden de Desarrollo Recomendado

1. Setup Docker Compose (PostgreSQL + Redis)
2. Modelos SQLAlchemy + migraciones Alembic
3. Endpoints CRUD de `Developer`
4. Integración Tavily (`/api/search/developers`)
5. Endpoints de `Template` (guardar árbol completo)
6. Scraper Playwright básico (nodo único, sin recursión)
7. Tarea Celery + integración con scraper
8. Recursión en el scraper (URL hijas)
9. Frontend: estructura base + routing
10. Frontend: Sección 1 (Desarrolladoras + tabs dinámicos)
11. Frontend: Sección 2 — catálogo y búsqueda Tavily
12. Frontend: Editor de plantilla (UrlNodeEditor recursivo)
13. Frontend: Progreso de scraping (polling)
14. Ajustes finales, manejo de errores, UX
