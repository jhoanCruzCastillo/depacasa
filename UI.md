# PropScraper — Documentación de Interfaz de Usuario (UI)
> Descripción completa del comportamiento visual e interactivo del sistema, pantalla por pantalla.

---

## Índice

1. [Layout General del Panel](#1-layout-general-del-panel)
2. [Sidebar de Navegación](#2-sidebar-de-navegación)
3. [Sección 1 — Desarrolladoras](#3-sección-1--desarrolladoras)
   - 3.1 Vista principal del catálogo
   - 3.2 Buscador y paginación
   - 3.3 DeveloperCard
   - 3.4 Vista de gestión de una desarrolladora
   - 3.5 Tabs dinámicos
   - 3.6 Cards de registros scrapeados
4. [Sección 2 — Plantillas de Extracción](#4-sección-2--plantillas-de-extracción)
   - 4.1 Layout de dos paneles
   - 4.2 Panel izquierdo — Buscador Tavily
   - 4.3 Resultados de búsqueda Tavily
   - 4.4 Agregar desarrolladora manualmente
   - 4.5 Panel derecho — Catálogo de desarrolladoras registradas
   - 4.6 Editor de plantilla de extracción
   - 4.7 Editor de nodo URL (UrlNodeEditor)
   - 4.8 Editor de campos (FieldEditor)
   - 4.9 Cadena de selectores DOM (SelectorChain)
   - 4.10 Nodos hijos (recursividad)
   - 4.11 Guardar plantilla
   - 4.12 Guardar y ejecutar scraping
5. [Modal de Progreso del Scraping](#5-modal-de-progreso-del-scraping)
6. [Estados de carga, vacío y error](#6-estados-de-carga-vacío-y-error)
7. [Sistema de notificaciones (Toasts)](#7-sistema-de-notificaciones-toasts)
8. [Comportamientos globales](#8-comportamientos-globales)

---

## 1. Layout General del Panel

El sistema se presenta como una **Single Page Application (SPA)** sin pantalla de login. Al acceder a la URL raíz, el usuario entra directamente al panel de administración.

### Estructura de la pantalla principal

```
┌──────────────────────────────────────────────────────────────────────┐
│  SIDEBAR (fijo, izquierda)  │  CONTENIDO PRINCIPAL (derecha, scroll) │
│  ─────────────────────────  │  ─────────────────────────────────────  │
│  Logo / Nombre del sistema  │                                         │
│                             │   [Área dinámica según sección activa]  │
│  > Desarrolladoras          │                                         │
│  > Plantillas de Extracción │                                         │
│                             │                                         │
│  ─────────────────────────  │                                         │
│  [Estado del sistema]       │                                         │
└──────────────────────────────────────────────────────────────────────┘
```

- El sidebar tiene **ancho fijo** (aprox. 240px) y **no hace scroll**.
- El área de contenido principal ocupa el resto del ancho y hace scroll verticalmente cuando el contenido lo requiere.
- El layout es **responsivo**: en pantallas menores a 768px el sidebar se colapsa en un menú hamburguesa (ícono) que se despliega como drawer sobre el contenido.

---

## 2. Sidebar de Navegación

### Elementos del sidebar (de arriba hacia abajo)

**Encabezado:**
- Logo del sistema (ícono de edificio o similar) + texto "PropScraper".
- Debajo del logo, un texto secundario pequeño: "Panel de Administración".

**Menú de navegación:**
- Ítem 1: **Desarrolladoras** (ícono de edificios/lista)
- Ítem 2: **Plantillas de Extracción** (ícono de código o engranaje)

**Comportamiento de los ítems:**
- El ítem activo se resalta con un fondo diferenciado (color primario con opacidad baja) y el texto/ícono en color primario completo.
- Al hacer clic en un ítem, el área de contenido principal cambia inmediatamente a la sección correspondiente sin recargar la página (React Router).
- La URL cambia: `/developers` para Desarrolladoras, `/templates` para Plantillas de Extracción.

**Pie del sidebar:**
- Indicador de estado del sistema: un punto de color verde si el backend está accesible, rojo si no. Texto al lado: "Sistema activo" / "Sin conexión".
- Este indicador hace ping al backend al cargar y cada 30 segundos.

---

## 3. Sección 1 — Desarrolladoras

**Ruta:** `/developers`

Esta sección es el catálogo de todas las plataformas inmobiliarias registradas en el sistema. Es la vista de **consulta y visualización** de datos.

---

### 3.1 Vista principal del catálogo

Al entrar a esta sección, el área de contenido principal muestra:

**Header de la sección:**
```
Desarrolladoras                              [Total: 12 plataformas]
Plataformas inmobiliarias registradas en el sistema.
```
- Título grande a la izquierda.
- Contador de total de desarrolladoras a la derecha (número en badge gris).
- Subtítulo descriptivo debajo del título.

**Barra de herramientas:**
- Input de búsqueda con ícono de lupa: placeholder "Buscar desarrolladora...".
- Botón de filtro (ícono de embudo) que puede expandir opciones adicionales (sin funcionalidad compleja en v1, preparado para extensión).
- Selector de vista: ícono de grilla (activo por defecto) / ícono de lista.

**Área de cards:**
- Grid responsivo de `DeveloperCard`s.
  - En pantallas grandes (≥1280px): 3 columnas.
  - En pantallas medianas (768–1279px): 2 columnas.
  - En pantallas pequeñas (<768px): 1 columna.
- Las cards se ordenan por defecto por fecha de creación (más reciente primero).

**Paginación (parte inferior):**
- Controles de paginación: "Anterior" / "Siguiente" + números de página.
- Selector de cantidad por página: 12 / 24 / 48 (por defecto 12).
- Texto informativo: "Mostrando 1–12 de 37 resultados".

---

### 3.2 Buscador y paginación

**Comportamiento del buscador:**
- El buscador es **local + en tiempo real**: filtra las cards visibles a medida que el usuario escribe (debounce de 300ms).
- La búsqueda aplica sobre: nombre de la desarrolladora, URL base, descripción.
- Si la búsqueda no devuelve resultados, se muestra el estado vacío (ver sección 6).
- Al limpiar el buscador (ícono X dentro del input), vuelve a mostrarse el catálogo completo.

**Comportamiento de la paginación:**
- La paginación opera sobre los resultados filtrados por el buscador.
- Al cambiar de página, el scroll del área de contenido vuelve al tope automáticamente.
- Si hay menos de 12 resultados, la paginación no se muestra.

---

### 3.3 DeveloperCard

Cada card en el catálogo tiene la siguiente estructura:

```
┌──────────────────────────────────────┐
│  [Logo / Avatar]   NOMBRE            │
│                    inmobiliaria.com  │
│                                      │
│  Descripción breve de la plataforma  │
│  (máx. 2 líneas, truncado con "...") │
│                                      │
│  ────────────────────────────────    │
│  [Badge: Tavily / Manual]            │
│  [Badge: Con plantilla / Sin plantilla]│
│  [Badge: Último scraping: hace 2h]   │
│                                      │
│               [GESTIONAR →]          │
└──────────────────────────────────────┘
```

**Detalle de los elementos:**

- **Logo / Avatar:** Si el developer tiene `logo_url`, se muestra la imagen. Si no, se muestra un avatar generado con las iniciales del nombre (ej: "NE" para "Nexo Inmobiliaria") sobre un fondo de color único basado en el nombre.
- **Nombre:** Texto grande, en negrita. Truncado si supera el ancho.
- **URL base:** Texto pequeño, en color secundario, con ícono de enlace. Al hacer clic abre la URL en pestaña nueva.
- **Descripción:** Máximo 2 líneas. Si el texto es más largo, se trunca con "..." y aparece un tooltip con la descripción completa al hacer hover.
- **Badges de estado:**
  - **Fuente:** Badge azul "Tavily" o badge gris "Manual" (según `source`).
  - **Plantilla:** Badge verde "Plantilla configurada" o badge naranja "Sin plantilla" (según si tiene UrlNodes asociados).
  - **Último scraping:** Badge con tiempo relativo (ej: "Scraping: hace 2h") si existe algún `ScrapeJob` completado. Si nunca se ejecutó: badge gris "Sin datos".
- **Botón GESTIONAR:** Botón primario (color de acento, ancho completo de la card). Al hacer clic navega a `/developers/{id}`.

**Hover sobre la card:**
- Sombra elevada y ligera escala (transform scale 1.01) para indicar interactividad.
- Transición suave de 150ms.

---

### 3.4 Vista de gestión de una desarrolladora

**Ruta:** `/developers/{id}`

Al hacer clic en "Gestionar" en una card, el área de contenido cambia a la vista de detalle del developer.

**Breadcrumb (navegación):**
```
Desarrolladoras > Nexo Inmobiliaria
```
- "Desarrolladoras" es un enlace que regresa a `/developers`.
- El nombre del developer es el ítem activo (no enlazable).

**Header editable:**
```
┌────────────────────────────────────────────────────────────┐
│  [Logo/Avatar grande]                                       │
│                                                             │
│  [Input: NOMBRE DE LA DESARROLLADORA]          [Guardar]   │
│  [Textarea: Descripción de la plataforma...]               │
│                                                             │
│  inmobiliaria.com · Fuente: Tavily · Creado: 12 ene 2025   │
└────────────────────────────────────────────────────────────┘
```

- El **nombre** es un input de texto editable inline. Tiene estilo de heading (grande, en negrita), pero al hacer clic se convierte en campo editable.
- La **descripción** es un textarea editable inline. Máximo 3 líneas visibles, expandible.
- El botón **"Guardar"** aparece solo cuando se ha modificado algún campo. Al hacer clic ejecuta `PATCH /api/developers/{id}` y muestra un toast de confirmación.
- Si el usuario hace clic fuera del campo sin guardar, aparece una alerta inline pequeña: "Tienes cambios sin guardar" con botones "Guardar" / "Descartar".
- La línea de metadatos (URL, fuente, fecha) es solo lectura.

---

### 3.5 Tabs dinámicos

Debajo del header, aparece una barra de **tabs horizontales**. Cada tab corresponde a un `UrlNode` del developer, ordenados por `UrlNode.order`.

```
[Proyectos]  [Departamentos]  [Casas]  ...
```

**Comportamiento:**

- Al cargar la vista, se selecciona automáticamente el **primer tab** (nodo raíz, `parent_id = null`).
- El tab activo se resalta con una línea inferior en color primario y texto en negrita.
- Al cambiar de tab, el área de contenido inferior cambia para mostrar los registros del nodo seleccionado. No hay recarga de página.
- Si el developer **no tiene plantilla configurada** (sin UrlNodes), no se muestran tabs y en su lugar aparece un mensaje:
  ```
  Esta desarrolladora no tiene plantilla de extracción configurada.
  [Ir a configurar plantilla →]
  ```
  El enlace navega a `/templates` y abre directamente el editor de ese developer.

- Si el developer tiene plantilla pero **nunca se ejecutó el scraping**, los tabs se muestran pero el área de contenido muestra el estado vacío con el mensaje "No hay datos extraídos aún".

---

### 3.6 Cards de registros scrapeados

Dentro del tab activo, se muestra un grid de cards con los registros `ScrapedRecord` de ese `UrlNode`.

**Card de registro (colapsada por defecto):**
```
┌──────────────────────────────────────────────────────┐
│  Proyecto Las Camelias                  [Ver más ↓]  │
│  precio: S/. 250,000 · ubicacion: Miraflores        │
│  Scrapeado: 12 ene 2025, 14:32                       │
└──────────────────────────────────────────────────────┘
```

- Se muestran los **2–3 primeros campos** del JSONB como preview inline.
- El nombre del registro se toma del primer campo de tipo texto que no sea URL.
- Fecha y hora del scraping en texto secundario.

**Al hacer clic en "Ver más":**

La card se expande (animación de apertura suave) y muestra **todos los campos** del JSONB en un layout de dos columnas:

```
┌──────────────────────────────────────────────────────┐
│  Proyecto Las Camelias                  [Ver menos ↑]│
│  ──────────────────────────────────────────────────  │
│  precio          S/. 250,000                         │
│  ubicacion       Miraflores, Lima                    │
│  area            85 m²                               │
│  dormitorios     3                                   │
│  banos           2                                   │
│  url_detalle     [enlace externo ↗]                  │
│  ──────────────────────────────────────────────────  │
│  Scrapeado: 12 ene 2025, 14:32 · Estado: ✓ Completo  │
└──────────────────────────────────────────────────────┘
```

- Los campos de tipo URL (que contengan "http") se renderizan como enlaces con ícono de enlace externo.
- Los campos con valor `null` se muestran como "—" en color gris.
- El estado del registro se muestra con ícono: ✓ verde (success), ⚠ amarillo (partial), ✕ rojo (failed).

**Paginación de registros:**
- Si hay más de 20 registros por nodo, se pagina en grupos de 20.
- Paginación simple: "Anterior" / "Siguiente" + contador "Página 1 de 5".

---

## 4. Sección 2 — Plantillas de Extracción

**Ruta:** `/templates`

Esta es la sección principal de configuración del sistema. Está dividida en **dos paneles laterales**.

---

### 4.1 Layout de dos paneles

```
┌────────────────────────────────────────────────────────────────────┐
│  PANEL IZQUIERDO (38%)       │  PANEL DERECHO (62%)                │
│  ────────────────────────    │  ──────────────────────────────      │
│  Buscador Tavily             │  Catálogo de desarrolladoras         │
│                              │  registradas                         │
│  [Resultados de búsqueda]    │                                      │
│                              │  [Grid de DeveloperCards]            │
│  [Agregar manualmente]       │                                      │
└────────────────────────────────────────────────────────────────────┘
```

- Los paneles están separados por un divisor vertical sutil.
- En pantallas pequeñas (<768px) se apilan verticalmente: primero el panel izquierdo, luego el derecho.
- El panel derecho tiene su propio scroll independiente si el catálogo es largo.

---

### 4.2 Panel izquierdo — Buscador Tavily

**Header del panel:**
```
Buscar Plataformas
Descubre nuevas inmobiliarias con Tavily
```

**Componentes del panel:**

**1. Input de búsqueda:**
- Input grande con ícono de lupa.
- Placeholder: "Ej: inmobiliarias en Lima, Nexo Inmobiliaria..."
- Al presionar Enter o hacer clic en el botón de búsqueda, se ejecuta la búsqueda.

**2. Botón "Buscar":**
- Botón primario, ancho completo.
- Texto: "Buscar con Tavily".
- Durante la búsqueda: el texto cambia a "Buscando..." con spinner giratorio. El botón queda deshabilitado.
- Si el input está vacío y se intenta buscar: aparece un mensaje de validación inline "Escribe al menos 2 caracteres".

**3. Separador visual:**
```
────── o ──────
```

**4. Botón "Agregar manualmente":**
- Botón secundario (outline), ancho completo.
- Ícono de "+" a la izquierda.
- Texto: "Agregar manualmente".
- Al hacer clic abre el Modal de registro manual (ver 4.4).

---

### 4.3 Resultados de búsqueda Tavily

Después de ejecutar una búsqueda, el panel izquierdo cambia para mostrar los resultados debajo del buscador.

**Header de resultados:**
```
Resultados para "inmobiliarias Lima"    [X Limpiar]
8 plataformas encontradas
```
- El texto "X Limpiar" al hacer clic regresa al estado inicial del panel (sin resultados).

**Barra de acciones masivas (aparece solo si hay resultados no registrados):**
```
[☑ Todos]  [☐ Ninguno]          [Agregar seleccionadas (3)]
```
- "Todos": marca todos los checkboxes de resultados no registrados.
- "Ninguno": desmarca todos.
- El botón "Agregar seleccionadas" muestra el conteo de items seleccionados entre paréntesis. Está deshabilitado si no hay ninguno seleccionado.

**Cards de resultados:**

Cada resultado de Tavily se muestra como una card compacta:

```
── Card: resultado NO registrado ──────────────────────────
☐  [Favicon]  Nexo Inmobiliaria
               nexoinmobiliaria.com.pe
               Plataforma líder en proyectos inmobiliarios...
──────────────────────────────────────────────────────────

── Card: resultado YA REGISTRADO ─────────────────────────
   [Favicon]  Urbania                    [✓ Ya agregado]
               urbania.pe
               Portal inmobiliario con miles de proyectos...
──────────────────────────────────────────────────────────
```

- Las cards **no registradas** tienen checkbox a la izquierda (seleccionable).
- Las cards **ya registradas** tienen un badge verde "✓ Ya agregado" a la derecha y **no tienen checkbox**. El fondo de la card es ligeramente más oscuro/desaturado para indicar que ya está en el sistema.
- El favicon se obtiene desde `https://www.google.com/s2/favicons?domain={url}`. Si no carga, se muestra el avatar de iniciales.
- La descripción se trunca a 2 líneas.

**Al hacer clic en "Agregar seleccionadas":**
1. El botón muestra spinner + texto "Agregando...".
2. Se llama a `POST /api/developers/bulk`.
3. Al completarse:
   - Toast verde: "3 desarrolladoras agregadas correctamente".
   - Las cards de los items agregados cambian a estado "Ya agregado" (con badge verde) y pierden su checkbox.
   - El catálogo del panel derecho se actualiza automáticamente con las nuevas cards.
   - El contador de seleccionados en el botón vuelve a cero.

---

### 4.4 Agregar desarrolladora manualmente

Al hacer clic en "Agregar manualmente", se abre un **Modal centrado** sobre la pantalla.

**Modal: "Agregar Desarrolladora"**

```
┌─────────────────────────────────────────────┐
│  Agregar Desarrolladora                  [X] │
│  ─────────────────────────────────────────  │
│                                             │
│  Nombre *                                   │
│  [___________________________________]      │
│                                             │
│  URL Base *                                 │
│  [https://___________________________]      │
│                                             │
│  Descripción                                │
│  [___________________________________]      │
│  [___________________________________]      │
│                                             │
│            [Cancelar]  [Agregar →]          │
└─────────────────────────────────────────────┘
```

**Validaciones en tiempo real:**
- **Nombre:** Requerido. Mínimo 2 caracteres. Error: "El nombre es requerido".
- **URL Base:** Requerida. Debe tener formato de URL válida (comienza con http:// o https://). Error: "Ingresa una URL válida". Al perder el foco, si el usuario no escribió el protocolo, se agrega automáticamente "https://".
- **Descripción:** Opcional. Sin validación.

**Al confirmar ("Agregar →"):**
1. Si hay errores de validación, se muestran debajo de cada campo afectado. No se envía el formulario.
2. Si es válido: el botón muestra "Agregando..." con spinner.
3. Se llama a `POST /api/developers`.
4. Al completarse:
   - Modal se cierra.
   - Toast verde: "Desarrolladora agregada correctamente".
   - La nueva card aparece al inicio del catálogo en el panel derecho.

**Al hacer clic en "Cancelar" o en la X:**
- Si el usuario ha escrito algo, aparece una confirmación pequeña: "¿Descartar cambios?" con "Sí, descartar" / "Continuar editando".
- Si los campos están vacíos, el modal se cierra directamente.

---

### 4.5 Panel derecho — Catálogo de desarrolladoras registradas

**Header del panel:**
```
Desarrolladoras Registradas              [Total: 12]
```

**Barra de herramientas del catálogo:**
- Input de búsqueda: filtra por nombre o URL (debounce 300ms).
- Botón "Filtros" que despliega un pequeño panel con opciones:
  - "Con plantilla configurada" (checkbox)
  - "Sin plantilla configurada" (checkbox)
  - "Con scraping ejecutado" (checkbox)
  - "Sin scraping ejecutado" (checkbox)
- Botón "Limpiar filtros" (aparece solo si hay filtros activos).

**Grid de DeveloperCards:**
- Usa el mismo componente `DeveloperCard` de la sección 1, pero en formato más compacto (2 columnas fijas en el panel).
- El botón de la card dice **"Gestionar"** (igual que en sección 1) pero en este contexto navega a `/templates/{id}/editor`.

**Paginación:**
- Si hay más de 8 cards en el panel derecho, aparece paginación en grupos de 8.

---

### 4.6 Editor de plantilla de extracción

**Ruta:** `/templates/{developer_id}/editor`

Al hacer clic en "Gestionar" en el panel derecho, el área de contenido completa cambia a la vista del editor de plantilla.

**Breadcrumb:**
```
Plantillas de Extracción > Nexo Inmobiliaria > Editor
```

**Header:**
```
┌────────────────────────────────────────────────────────────┐
│  [Logo]  Nexo Inmobiliaria                                  │
│          nexoinmobiliaria.com.pe                            │
└────────────────────────────────────────────────────────────┘
```

**Tabs del editor:**
```
[Plantilla de Extracción ★]  [Proyectos]  [Departamentos]
```
- El tab "Plantilla de Extracción" está siempre presente (es el editor).
- Los demás tabs son dinámicos: uno por cada `UrlNode` que tenga la plantilla guardada (igual que en sección 1, pero aquí muestran los datos scrapeados del developer actual).
- El tab activo al entrar es siempre "Plantilla de Extracción".
- Si la plantilla nunca fue configurada, solo existe el tab "Plantilla de Extracción".

---

### 4.7 Editor de nodo URL (UrlNodeEditor)

Dentro del tab "Plantilla de Extracción", se muestra el **editor del nodo raíz**.

**Estructura visual del nodo raíz:**

```
┌─────────────────────────────────────────────────────────────────┐
│  SECCIÓN RAÍZ                                         [✕ Eliminar nodo]│
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  Nombre de la sección *                                         │
│  [Proyectos                                               ]     │
│  Ej: "Proyectos", "Departamentos", "Propiedades en venta"       │
│                                                                 │
│  URL de la sección *                                            │
│  [https://nexoinmobiliaria.com/proyectos                  ]     │
│  URL donde están listados los items a extraer                   │
│                                                                 │
│  ─── Campos a extraer ───────────────────────────────────────  │
│                                                                 │
│  [FieldEditor: Campo 1]                                         │
│  [FieldEditor: Campo 2]                                         │
│  [FieldEditor: Campo 3]                                         │
│                                                                 │
│  [+ Agregar campo]                                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Validaciones:**
- **Nombre de sección:** Requerido. Mínimo 2 caracteres.
- **URL:** Requerida. Debe ser URL válida.

**Si es el nodo raíz** (depth = 0): no aparece el botón "Eliminar nodo" (el nodo raíz no se puede eliminar, solo su contenido).

**Si es un nodo hijo** (depth > 0): aparece el botón "✕ Eliminar nodo" en la esquina superior derecha. Al hacer clic aparece una confirmación: "¿Eliminar esta sección y todos sus campos? Esta acción no se puede deshacer." con botones "Sí, eliminar" / "Cancelar".

---

### 4.8 Editor de campos (FieldEditor)

Cada campo a extraer dentro de un nodo se representa con un **FieldEditor**. Es un bloque expandible/colapsable.

**Estado colapsado (por defecto):**
```
┌──────────────────────────────────────────────────────────────────┐
│  ≡  precio                          [URL hija: No]  [↑][↓][✕]   │
└──────────────────────────────────────────────────────────────────┘
```
- Ícono de arrastre (≡) a la izquierda: permite reordenar campos con drag & drop.
- Nombre del campo.
- Badge "URL hija: Sí / No" indicando si está marcado como URL hija.
- Botones de orden: flechas ↑ y ↓ para mover el campo arriba/abajo.
- Botón ✕ para eliminar el campo.

**Al hacer clic en el FieldEditor (expandir):**

```
┌──────────────────────────────────────────────────────────────────┐
│  ≡  ▼ Campo                                         [↑][↓][✕]   │
│  ─────────────────────────────────────────────────────────────   │
│                                                                  │
│  Nombre del campo *                                              │
│  [precio                                                   ]     │
│  Ej: "precio", "titulo", "url_detalle", "dormitorios"           │
│                                                                  │
│  Selectores DOM (orden descendente)                              │
│  [SelectorChain]                                                 │
│                                                                  │
│  ──────────────────────────────────────────────────────────      │
│  ☐  Este campo es una URL hija                                   │
│     (el valor extraído será la URL de la siguiente sección)      │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Nombre del campo:**
- Input de texto libre. El usuario escribe el nombre que tendrá ese campo en el JSON resultante.
- Solo se permiten letras, números y guiones bajos. Sin espacios.
- Placeholder: "nombre_campo".
- Validación: requerido, mínimo 1 carácter, sin espacios.

**Checkbox "Este campo es una URL hija":**
- Al marcar este checkbox, el FieldEditor cambia visualmente:
  - El badge en el estado colapsado cambia a "URL hija: ✓".
  - Aparece un botón debajo del checkbox (ver 4.10).

---

### 4.9 Cadena de selectores DOM (SelectorChain)

La `SelectorChain` es el componente dentro del `FieldEditor` donde el usuario define **cómo encontrar el valor del campo en el DOM**.

**Estructura visual:**

```
  Selectores DOM (orden descendente)
  Agrega los selectores de mayor a menor jerarquía en el DOM

  Nivel 1 (contenedor más externo)
  [div.card-proyecto                            ] [✕]

  Nivel 2
  [div.info-precio                              ] [✕]

  Nivel 3 (elemento que contiene el valor)
  [span.monto                                   ] [✕]

  [+ Agregar nivel]
```

**Cada nivel de selector:**
- Input de texto con placeholder según su posición:
  - Nivel 1: "Ej: div.contenedor, .lista-cards, #main"
  - Niveles siguientes: "Ej: div.item, span.precio, a.enlace"
- Botón ✕ a la derecha para eliminar ese nivel. No se puede eliminar si solo hay un nivel.
- Los niveles se pueden reordenar con drag & drop (ícono de arrastre a la izquierda del input).

**Reglas de formato del selector:**
- Se aceptan: `etiqueta`, `.clase`, `#id`, `etiqueta.clase`, `etiqueta#id`.
- No se permiten combinadores CSS (`>`, `+`, `~`) — esos los agrega el sistema automáticamente al construir el query.
- Si el usuario ingresa un selector inválido (ej: espacios en el medio, caracteres especiales), se muestra un error inline: "Selector inválido. Usa etiqueta, .clase o #id".

**Botón "+ Agregar nivel":**
- Agrega un nuevo input de selector al final de la cadena.
- Máximo 10 niveles por cadena (límite práctico).

**Tooltip informativo (ícono ?) junto al título:**
- Al hacer hover o clic, aparece un tooltip/popover con esta explicación:
  ```
  ¿Cómo funcionan los selectores?
  
  Indica los elementos del DOM de manera descendente,
  desde el más externo hasta el que contiene el valor.
  
  Puedes omitir niveles intermedios, el sistema los
  buscará de forma flexible.
  
  Ejemplos:
  • div.card-proyecto → span.precio → (texto)
  • .listado-items → a.link-detalle → (href)
  • #container → .nombre-proyecto → (texto)
  ```

---

### 4.10 Nodos hijos (recursividad)

Cuando el usuario marca el checkbox **"Este campo es una URL hija"** en un `FieldEditor`, sucede lo siguiente:

**1. Aparece un botón debajo del checkbox:**
```
☑  Este campo es una URL hija
   (el valor extraído será la URL de la siguiente sección)

   [+ Crear sección hija para "url_detalle"]
```

**2. Al hacer clic en "Crear sección hija":**

Se inserta debajo del `UrlNodeEditor` padre un nuevo bloque `UrlNodeEditor` hijo, **visualmente indentado** y con un estilo de fondo diferenciado para indicar que es un nivel más profundo:

```
┌─────────────────────────────────────────────────────────────────┐
│  SECCIÓN RAÍZ                                                   │
│  ─────────────────────────────────────────────────────────────  │
│  Nombre: [Proyectos]                                            │
│  URL:    [https://nexo.com/proyectos]                           │
│                                                                 │
│  Campos:                                                        │
│    · titulo                                                     │
│    · precio                                                     │
│    · url_detalle ✓ [URL hija]                                   │
│                                                                 │
│    ┌── SECCIÓN HIJA (desde "url_detalle") ───────────────────┐  │
│    │  NIVEL 2                              [✕ Eliminar nodo]  │  │
│    │  ───────────────────────────────────────────────────     │  │
│    │  Nombre de la sección *                                  │  │
│    │  [Detalle del Proyecto                            ]      │  │
│    │                                                          │  │
│    │  (URL dinámica — tomada del campo "url_detalle")         │  │
│    │                                                          │  │
│    │  Campos a extraer:                                       │  │
│    │  [FieldEditor: Campo A]                                  │  │
│    │  [FieldEditor: Campo B]                                  │  │
│    │                                                          │  │
│    │  [+ Agregar campo]                                       │  │
│    └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

**Detalles del nodo hijo:**
- El campo **URL** no aparece (o aparece como solo lectura con texto "URL dinámica — tomada del campo '{nombre_campo_padre}'"), ya que la URL será cada valor que extraiga el scraper del campo marcado como URL hija en el padre.
- El campo **Nombre de sección** sí es editable (ej: "Detalle del Proyecto").
- El nodo hijo tiene su propia lista de `FieldEditor`s, con su propia `SelectorChain`.
- Cada `FieldEditor` del nodo hijo puede también ser marcado como URL hija, generando un **nivel 3**, y así sucesivamente.

**Indicador de profundidad:**
- Nivel 1 (raíz): fondo blanco/normal, sin indentación.
- Nivel 2 (hijo): borde izquierdo de color primario + fondo ligeramente diferenciado + indentación de 24px.
- Nivel 3 (nieto): borde izquierdo de color secundario + fondo más diferenciado + indentación de 48px.
- Niveles 4+: misma lógica, con indentación de 24px adicionales por nivel.

**Máximo de profundidad:** Sin límite técnico. Se muestra una advertencia informativa al llegar al nivel 5: "Estás en una profundidad de 5 niveles. Asegúrate de que la estructura refleja la jerarquía real del sitio."

---

### 4.11 Guardar plantilla

Al final del editor (debajo de todos los nodos), aparece la **barra de acciones**:

```
──────────────────────────────────────────────────────────────────
[← Volver al catálogo]                [Guardar plantilla]  [Guardar y Ejecutar ▶]
──────────────────────────────────────────────────────────────────
```

**Botón "Guardar plantilla":**
- Valida todos los campos requeridos del árbol completo (nombres de sección, URLs, nombres de campos, al menos un selector por campo).
- Si hay errores: se muestran mensajes de error inline en cada campo afectado y el scroll sube automáticamente al primer error. No se envía nada al backend.
- Si es válido: muestra spinner + "Guardando..." y llama a `POST /api/developers/{id}/template` con el árbol completo serializado.
- Al completarse: toast verde "Plantilla guardada correctamente". Los tabs de la sección "Plantilla de Extracción" se actualizan para reflejar los nuevos nodos (si cambiaron sus nombres).

**Botón "← Volver al catálogo":**
- Si hay cambios sin guardar, aparece confirmación: "¿Salir sin guardar? Los cambios se perderán." con "Salir" / "Quedarme".
- Si no hay cambios, navega directamente a `/templates`.

---

### 4.12 Guardar y ejecutar scraping

**Botón "Guardar y Ejecutar ▶":**
1. Primero ejecuta las mismas validaciones que "Guardar plantilla".
2. Si es válido, guarda la plantilla (`POST /api/developers/{id}/template`).
3. Inmediatamente después, llama a `POST /api/scrape/{developer_id}/run`.
4. Se abre el **Modal de Progreso del Scraping** (ver sección 5).

---

## 5. Modal de Progreso del Scraping

Al iniciar un scraping, aparece un **modal de progreso** que cubre la pantalla con un overlay oscuro semitransparente. El modal no se puede cerrar mientras el scraping está en curso.

```
┌────────────────────────────────────────────────────────┐
│  Ejecutando Scraping                                    │
│  Nexo Inmobiliaria                                      │
│  ────────────────────────────────────────────────────  │
│                                                         │
│  Estado: Extrayendo datos de "Proyectos"...             │
│                                                         │
│  [████████████████░░░░░░░░░░░░░░] 47%                  │
│                                                         │
│  Registros extraídos: 23 / ~50 estimados               │
│  Sección actual: Proyectos → Detalle del Proyecto       │
│  Tiempo transcurrido: 00:01:23                          │
│                                                         │
│  Log de actividad:                                      │
│  ┌──────────────────────────────────────────────────┐  │
│  │ ✓ Conectando a https://nexo.com/proyectos...     │  │
│  │ ✓ Encontrados 50 items en la página              │  │
│  │ ✓ Extrayendo item 1: "Proyecto Las Camelias"     │  │
│  │   → Siguiendo URL hija: /proyectos/las-camelias  │  │
│  │ ✓ Extraídos 8 campos del detalle                 │  │
│  │ ⚡ Extrayendo item 2: "Proyecto San Isidro"...   │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
└────────────────────────────────────────────────────────┘
```

**Comportamiento:**
- El log de actividad es un área de texto con scroll automático al último mensaje.
- Los mensajes del log tienen íconos: ✓ (completado), ⚡ (en progreso), ⚠ (advertencia), ✕ (error parcial).
- La barra de progreso es **estimada** (basada en el total de items detectados en la primera pasada). Si no se puede estimar, muestra una barra de progreso indeterminada (animación de barrido).
- El polling al backend es cada 3 segundos: `GET /api/scrape/jobs/{job_id}`.

**Al completarse exitosamente:**
```
┌────────────────────────────────────────────────────────┐
│  ✓ Scraping Completado                                  │
│  ────────────────────────────────────────────────────  │
│                                                         │
│  Nexo Inmobiliaria                                      │
│  50 registros extraídos correctamente                   │
│  2 registros con datos parciales (campos faltantes)     │
│  Tiempo total: 00:02:47                                 │
│                                                         │
│            [Ver datos extraídos →]   [Cerrar]           │
└────────────────────────────────────────────────────────┘
```
- "Ver datos extraídos →" navega a `/developers/{id}` con el primer tab activo.
- "Cerrar" cierra el modal y permanece en el editor.

**Al fallar:**
```
┌────────────────────────────────────────────────────────┐
│  ✕ Error en el Scraping                                 │
│  ────────────────────────────────────────────────────  │
│                                                         │
│  El proceso falló al conectar con la URL de destino.   │
│  Verifica que la URL sea accesible y los selectores     │
│  sean correctos.                                        │
│                                                         │
│  Detalle del error:                                     │
│  TimeoutError: Waiting for selector "div.card-proyecto" │
│  exceeded 30000ms                                       │
│                                                         │
│            [Reintentar]   [Cerrar]                      │
└────────────────────────────────────────────────────────┘
```
- "Reintentar" vuelve a llamar a `POST /api/scrape/{developer_id}/run` sin cerrar el modal.
- "Cerrar" cierra el modal. En este caso sí se puede cerrar (el job ya está en estado `failed`).

---

## 6. Estados de carga, vacío y error

Estos estados aplican en todos los grids y listas del sistema.

### Estado de carga (Skeleton)

Mientras se carga la data del backend, en lugar de un spinner genérico, se muestran **skeleton cards** que replican la estructura de las cards reales pero con bloques grises animados (shimmer effect).

```
┌──────────────────────────────────────┐
│  ████████████████  ████████████████  │  ← Skeleton del avatar + nombre
│                                      │
│  ████████████████████████████████    │  ← Skeleton de la descripción
│  ████████████████████                │
│                                      │
│  ──────────────────────────────      │
│  ████████  ████████████████          │  ← Skeleton de badges
│                                      │
│  ████████████████████████████████    │  ← Skeleton del botón
└──────────────────────────────────────┘
```

### Estado vacío

Cuando una lista o catálogo no tiene resultados (sin datos o sin resultados de búsqueda):

```
         [Ícono ilustrativo grande]

         No hay desarrolladoras registradas
         Comienza buscando plataformas inmobiliarias
         con Tavily o agrégalas manualmente.

         [Ir a Plantillas de Extracción →]
```

Variaciones según contexto:
- **Catálogo de developers vacío:** sugiere ir a Plantillas de Extracción.
- **Búsqueda sin resultados en el catálogo:** "No se encontraron resultados para '{búsqueda}'. Intenta con otro término."
- **Tab sin registros scrapeados:** "No hay datos extraídos para esta sección. Ejecuta el scraping para obtener información."
- **Resultados Tavily sin match:** "No se encontraron plataformas para '{búsqueda}'. Prueba con términos más generales."

### Estado de error

Si el fetch al backend falla (red, timeout, error 500):

```
         [Ícono de error / triángulo con !]

         Error al cargar los datos
         No se pudo conectar con el servidor.
         Verifica tu conexión e intenta de nuevo.

         [Reintentar]
```

- El botón "Reintentar" vuelve a ejecutar la misma petición.
- Si el error es un 404 (ej: developer no encontrado): "Esta desarrolladora no existe o fue eliminada." con un enlace para volver al catálogo.

---

## 7. Sistema de notificaciones (Toasts)

Los toasts aparecen en la **esquina superior derecha** de la pantalla, apilados verticalmente si hay varios.

**Duración:**
- Éxito: 3 segundos auto-dismiss.
- Advertencia: 5 segundos auto-dismiss.
- Error: No se cierran automáticamente. El usuario debe hacer clic en X.

**Tipos:**

```
✓  Plantilla guardada correctamente.                          [X]   ← Verde
⚠  2 registros se guardaron con campos incompletos.           [X]   ← Amarillo
✕  Error al conectar con el backend. Intenta de nuevo.        [X]   ← Rojo
ℹ  El scraping está en progreso. Puedes seguir navegando.     [X]   ← Azul
```

**Toasts específicos del sistema:**
- Al agregar developers desde Tavily: "N desarrolladoras agregadas correctamente."
- Al guardar plantilla: "Plantilla guardada correctamente."
- Al completar scraping: "Scraping completado. 50 registros extraídos."
- Al fallar scraping: "El scraping falló. Revisa los selectores configurados."
- Al editar developer: "Cambios guardados."
- Al eliminar un nodo de la plantilla: "Sección eliminada." con botón "Deshacer" (5 segundos para revertir, solo en cliente).

---

## 8. Comportamientos globales

### Navegación con cambios sin guardar

En el editor de plantilla, si el usuario intenta navegar fuera (cambiar de sección en el sidebar, o hacer clic en un breadcrumb) con cambios sin guardar, aparece un dialog de confirmación nativo del navegador o un modal personalizado:

```
¿Salir sin guardar?
Los cambios en la plantilla se perderán si sales ahora.

[Salir sin guardar]   [Seguir editando]
```

### Indicador de cambios pendientes

Mientras el usuario edita la plantilla sin guardar, aparece un indicador visual sutil en la barra de acciones:

```
● Cambios sin guardar
```

Un punto naranja pulsante seguido del texto. Desaparece al guardar.

### Drag & Drop en campos

Los `FieldEditor`s dentro de un `UrlNodeEditor` son reordenables con drag & drop:
- Al iniciar el drag, la card se eleva visualmente (sombra más pronunciada, ligera rotación de 2deg).
- El área de destino se muestra con una línea azul horizontal indicando dónde se soltará el elemento.
- Al soltar, los `order` de los campos se actualizan en el estado local. Se persisten al guardar la plantilla.

### Responsive y accesibilidad

- Todos los botones e inputs tienen labels correctas para lectores de pantalla.
- El foco del teclado es visible en todos los elementos interactivos.
- Los modales atrapan el foco dentro de ellos mientras están abiertos (focus trap).
- Al cerrar un modal, el foco regresa al elemento que lo abrió.
- Los toasts se anuncian con `aria-live="polite"`.

### Persistencia del estado UI

- La página activa del catálogo de desarrolladoras se guarda en la URL como query param: `/developers?page=2&q=nexo`.
- El tab activo en la vista de gestión de un developer se guarda en la URL: `/developers/{id}?tab=departamentos`.
- El tab activo en el editor de plantilla se guarda en la URL: `/templates/{id}/editor?tab=extraccion`.
- Esto permite compartir links directos a vistas específicas y preservar el estado al refrescar la página.