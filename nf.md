Agrga esta nueva funcionalidad y adaptala a lo que ya tenemos, no adaptes nuestro proyecto a esta nueva funcionalidad, adapta esta nueva funcionalidad al proyecto que ya tenemos:

# Nueva Funcionalidad: Selector Visual + Generación de Plantillas con IA

## Descripción general

Se incorpora al sistema de scraping una nueva forma de crear plantillas de extracción. En lugar de escribir selectores DOM manualmente, el usuario podrá interactuar directamente con la página web renderizada y dejar que el sistema genere los selectores de forma automática, ya sea mediante selección visual con el mouse o mediante asistencia inteligente con la API de Anthropic.

Esta funcionalidad se integra en el flujo actual de configuración de plantillas, como una alternativa mejorada al editor manual existente.

---

## Objetivo

Reducir drásticamente el tiempo de configuración de una plantilla de extracción y mejorar la precisión de los selectores generados, eliminando la necesidad de inspeccionar el código fuente del sitio manualmente.

El usuario podrá:

- Ver la página web real renderizada dentro del sistema.
- Pasar el mouse sobre los elementos para resaltarlos.
- Hacer clic en un elemento para capturar su selector.
- Dejar que la IA detecte y nombre automáticamente todos los campos relevantes.
- Validar la plantilla generada antes de guardarla.

---

## Arquitectura

El sistema usa un navegador real controlado desde el backend. El frontend no renderiza la página directamente (no usa iframes), sino que recibe una representación visual o snapshot de la página que Playwright tiene abierta.

```
Usuario (Frontend React)
       │
       │  WebSocket bidireccional
       ▼
Backend FastAPI + WebSocket Server
       │
       │  Playwright API (Python)
       ▼
Chromium headless (navegador real)
       │
       │  Renderiza la URL objetivo
       ▼
Página web real (HTML + JS ejecutado)
```

### Flujo de datos en modo selección

```
Click del usuario en la UI
       │
       │  Coordenadas (x, y) vía WebSocket
       ▼
Backend recibe coordenadas
       │
       │  Playwright evalúa el elemento en esas coordenadas
       ▼
Se extrae: outerHTML + selector generado
       │
       │  Respuesta vía WebSocket
       ▼
Frontend muestra el selector capturado
       │
       │  (opcional) Se envía a Anthropic para enriquecer
       ▼
IA devuelve: nombre del campo + selector optimizado + confianza
```

---

## Tecnologías utilizadas

| Tecnología | Rol |
|---|---|
| **Playwright (Python)** | Abre y controla el navegador real. Ejecuta JS, captura HTML, inyecta scripts de selección. |
| **WebSocket (FastAPI)** | Canal bidireccional entre el frontend y el backend para eventos de selección en tiempo real. |
| **Anthropic API (Claude)** | Analiza fragmentos HTML y genera nombres de campo + selectores optimizados. |
| **JS Injection (Playwright)** | Inyecta el script de hover/click en la página renderizada para capturar eventos del DOM. |
| **Screenshot / DOM Snapshot** | El backend toma capturas de pantalla o envía el HTML renderizado para que el frontend lo muestre. |

---

## Punto de entrada en la UI

Esta funcionalidad se activa desde el editor de plantillas (`/templates/{developer_id}/editor`), en la sección del `UrlNodeEditor`.

Al ingresar la URL de una sección, aparece un nuevo botón junto al input de URL:

```
URL de la sección *
[https://nexo.com/proyectos                         ]   [Abrir selector visual ↗]
```

Al hacer clic en **"Abrir selector visual"**, se abre un panel o modal de pantalla completa con el navegador embebido.

---

## Modos de trabajo

Al abrir el selector visual, el usuario elige entre dos modos:

```
┌────────────────────────────────────────────────────────────┐
│  ¿Cómo deseas configurar los campos?                        │
│                                                             │
│  ┌─────────────────────┐   ┌─────────────────────────────┐ │
│  │  Selección manual   │   │  Asistido por IA            │ │
│  │                     │   │                             │ │
│  │  Haz clic sobre     │   │  La IA analiza la página    │ │
│  │  cada elemento que  │   │  y genera automáticamente   │ │
│  │  quieres extraer.   │   │  todos los campos.          │ │
│  │  Tú decides el      │   │  Tú revisas y ajustas.      │ │
│  │  nombre de cada     │   │                             │ │
│  │  campo.             │   │                             │ │
│  └─────────────────────┘   └─────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

Ambos modos comparten la misma vista de navegador embebido. La diferencia está en quién genera los selectores y los nombres de campo.

---

## Modo Manual (Selector Visual)

### Layout del panel

```
┌───────────────────────────────────────────────────────────────────────┐
│  TOOLBAR SUPERIOR                                                      │
│  [URL activa: nexo.com/proyectos]   [Modo: Manual]   [Cerrar ✕]       │
│  [Selección activa: ON]   [Deshacer]   [Limpiar todo]   [Confirmar →] │
├────────────────────────────────────────┬──────────────────────────────┤
│                                        │  PANEL DE CAMPOS CAPTURADOS  │
│  VISTA DE LA PÁGINA RENDERIZADA        │  ─────────────────────────── │
│  (screenshot o DOM interactivo)        │                              │
│                                        │  Campo 1:                    │
│  Al pasar el mouse:                    │  Nombre: [precio        ]    │
│  → el elemento bajo el cursor          │  Selector: .card .price      │
│    se resalta con borde rojo           │  Preview: "S/. 250,000"      │
│                                        │  [✕ eliminar]                │
│  Al hacer clic:                        │                              │
│  → se captura el selector              │  Campo 2:                    │
│  → aparece en el panel derecho         │  Nombre: [ubicacion     ]    │
│                                        │  Selector: .card .location   │
│                                        │  Preview: "Miraflores, Lima" │
│                                        │  [✕ eliminar]                │
│                                        │                              │
│                                        │  [+ Agregar campo]           │
└────────────────────────────────────────┴──────────────────────────────┘
```

### Paso a paso del flujo manual

**Paso 1 — Carga de la página:**
El backend abre la URL con Playwright y envía un screenshot inicial al frontend. Este screenshot se muestra en el panel izquierdo como imagen interactiva.

**Paso 2 — Activación del modo selección:**
El backend inyecta un script en la página que captura eventos `mouseover` y `click`:

```js
document.addEventListener("mouseover", (e) => {
  // Resaltar el elemento bajo el cursor
  if (currentHighlighted) {
    currentHighlighted.style.outline = "";
  }
  e.target.style.outline = "2px solid #ef4444";
  currentHighlighted = e.target;
});

document.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();

  const element = e.target;
  const selector = generateMinimalSelector(element);

  // Enviar al backend vía canal interno de Playwright
  window.__sendSelection({
    html: element.outerHTML,
    text: element.innerText.trim(),
    selector: selector,
    tagName: element.tagName.toLowerCase()
  });
});
```

La función `generateMinimalSelector` construye el selector más corto y específico posible usando clases, IDs y relaciones con el elemento padre inmediato.

**Paso 3 — Captura del elemento:**
Cuando el usuario hace clic en un elemento de la página renderizada:
- El backend recibe el `outerHTML` y el `selector`.
- Envía los datos al frontend vía WebSocket.
- En el panel derecho aparece un nuevo campo con:
  - Input de nombre editable (el usuario escribe "precio", "ubicacion", etc.).
  - Selector generado (editable si el usuario quiere ajustarlo).
  - Preview del valor extraído (el `innerText` del elemento).
  - Indicador de cuántos resultados encontraría ese selector en la página actual (ej: "14 coincidencias").

**Paso 4 — Confirmación:**
El usuario hace clic en **"Confirmar →"**. Los campos capturados se trasladan automáticamente al `UrlNodeEditor` correspondiente, rellenando los `FieldEditor`s y sus `SelectorChain`s. El panel del selector visual se cierra.

---

## Modo IA (Anthropic)

### Flujo

**Paso 1 — Carga de la página:**
Igual que en modo manual: el backend abre la URL con Playwright.

**Paso 2 — Captura del HTML relevante:**
El backend extrae el HTML de la sección de la página que contiene los cards o items de listado. Para esto:
- Playwright ejecuta scroll hacia abajo para activar lazy loading.
- Se espera `networkidle` para asegurar que el contenido dinámico esté cargado.
- Se extrae el `innerHTML` del contenedor principal de items (el elemento más probable se detecta buscando el elemento con mayor número de hijos directos similares).

**Paso 3 — Envío a Anthropic:**

El backend llama a la API de Anthropic con el siguiente prompt estructurado:

```
Sistema:
Eres un experto en web scraping. Tu tarea es analizar un fragmento HTML
de una página de listado inmobiliario e identificar los campos relevantes
que se deben extraer de cada item/card.

Devuelve ÚNICAMENTE un JSON con la siguiente estructura, sin explicaciones:
{
  "card_selector": "selector CSS del contenedor de cada item",
  "fields": [
    {
      "name": "nombre_del_campo_en_snake_case",
      "selector": "selector CSS relativo al card",
      "type": "text|url|number|image",
      "confidence": 0.0 a 1.0
    }
  ]
}

Usuario:
Contexto: página de listado de propiedades inmobiliarias.
HTML:
{html_fragment}
```

**Paso 4 — Respuesta de la IA:**

Ejemplo de respuesta esperada:

```json
{
  "card_selector": ".card-property",
  "fields": [
    {
      "name": "titulo",
      "selector": ".card-property .title",
      "type": "text",
      "confidence": 0.97
    },
    {
      "name": "precio",
      "selector": ".card-property .price-tag",
      "type": "number",
      "confidence": 0.95
    },
    {
      "name": "area",
      "selector": ".card-property .m2",
      "type": "text",
      "confidence": 0.88
    },
    {
      "name": "dormitorios",
      "selector": ".card-property .rooms-count",
      "type": "number",
      "confidence": 0.84
    },
    {
      "name": "ubicacion",
      "selector": ".card-property .location-text",
      "type": "text",
      "confidence": 0.91
    },
    {
      "name": "url_detalle",
      "selector": ".card-property a.detail-link",
      "type": "url",
      "confidence": 0.99
    }
  ]
}
```

**Paso 5 — Presentación al usuario:**

El frontend muestra los campos generados por la IA en el panel derecho, con indicadores de confianza:

```
┌────────────────────────────────────────────────────────────┐
│  La IA detectó 6 campos                    [Aceptar todo]  │
│  Revisa y ajusta antes de confirmar                        │
│  ─────────────────────────────────────────────────────     │
│                                                            │
│  ✓ titulo          .card-property .title       [97%] [✕]  │
│  ✓ precio          .card-property .price-tag   [95%] [✕]  │
│  ✓ area            .card-property .m2          [88%] [✕]  │
│  ✓ dormitorios     .card-property .rooms-count [84%] [✕]  │
│  ✓ ubicacion       .card-property .location    [91%] [✕]  │
│  ✓ url_detalle     .card-property a.detail-link[99%] [✕]  │
│                                                            │
│  Cada campo es editable. Haz clic para ajustar.           │
│                                                            │
│              [Regenerar]        [Confirmar →]             │
└────────────────────────────────────────────────────────────┘
```

- Los campos con confianza ≥ 90% tienen ícono verde ✓.
- Los campos con confianza entre 70–89% tienen ícono amarillo ⚠.
- Los campos con confianza < 70% tienen ícono rojo ✕ y se recomiendan revisar o eliminar.
- Cada campo es editable: nombre, selector y tipo.
- El botón **"Regenerar"** vuelve a llamar a Anthropic (útil si el primer resultado no fue satisfactorio).
- El botón **"Confirmar →"** traslada los campos aceptados al `UrlNodeEditor`.

Los campos de tipo `url` se marcan automáticamente como **URL hija** en el `FieldEditor`, habilitando la creación de la sección hija correspondiente.

---

## Validación automática de la plantilla

Disponible en ambos modos, antes de confirmar. Se ejecuta con el botón **"Validar selectores"** o automáticamente al confirmar.

El backend ejecuta los selectores generados sobre la página actualmente cargada en Playwright y devuelve:

```
Resultado de validación:

  ✓ card_selector       → 24 cards encontradas
  ✓ titulo              → 24/24 valores extraídos
  ✓ precio              → 22/24 valores extraídos  (2 sin datos)
  ✓ area                → 24/24 valores extraídos
  ⚠ dormitorios         → 18/24 valores extraídos  (6 sin datos)
  ✓ ubicacion           → 24/24 valores extraídos
  ✓ url_detalle         → 24/24 URLs encontradas

Preview de los primeros 3 resultados:
┌────────────────────────────────────────────────────────────────┐
│ { titulo: "Proyecto Las Camelias", precio: "S/. 250,000",      │
│   area: "85 m²", dormitorios: "3", ubicacion: "Miraflores",   │
│   url_detalle: "https://nexo.com/proyectos/las-camelias" }     │
├────────────────────────────────────────────────────────────────┤
│ { titulo: "Residencial San Isidro", precio: "S/. 380,000",     │
│   area: "110 m²", dormitorios: null, ubicacion: "San Isidro", │
│   url_detalle: "https://nexo.com/proyectos/san-isidro" }       │
├────────────────────────────────────────────────────────────────┤
│ { titulo: "Torres del Sol", precio: null,                      │
│   area: "72 m²", dormitorios: "2", ubicacion: "Surco",        │
│   url_detalle: "https://nexo.com/proyectos/torres-sol" }       │
└────────────────────────────────────────────────────────────────┘
```

Si algún campo tiene 0 coincidencias, se bloquea la confirmación y se muestra el error: "El selector '{selector}' no encontró ningún elemento. Revísalo antes de continuar."

---

## Consideraciones técnicas

### Renderizado remoto (no iframe)

No se usa `<iframe>` para mostrar la página por las siguientes razones:
- La mayoría de sitios bloquean el embebido con `X-Frame-Options: DENY` o `Content-Security-Policy: frame-ancestors 'none'`.
- El DOM del iframe está aislado y no permite inyectar scripts de selección.
- Los estilos y scripts externos pueden interferir con la UI del sistema.

La solución adoptada es **screenshot polling**: Playwright toma capturas de pantalla de la página y las envía al frontend como imágenes (base64 o blob URL) a través del WebSocket. Las coordenadas del clic del usuario en la imagen se traducen a coordenadas reales del viewport y se envían al backend para que Playwright interactúe con el elemento real.

### Traducción de coordenadas

```
Coordenadas del clic en la imagen (frontend)
       │
       │  Escala según el ratio: imagen_width / viewport_width
       ▼
Coordenadas reales en el viewport del navegador
       │
       │  Playwright: page.mouse.click(x_real, y_real)
       ▼
El script inyectado captura el elemento bajo esas coordenadas
```

### Sitios con contenido dinámico

Playwright maneja de forma nativa:
- Contenido renderizado con JavaScript (React, Vue, Angular).
- Lazy loading al hacer scroll.
- Peticiones AJAX que cargan más items.

Antes de tomar el snapshot o capturar el HTML, el backend siempre ejecuta:

```python
await page.wait_for_load_state("networkidle")
await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
await page.wait_for_timeout(1500)  # espera items de lazy load
```

### Casos especiales

| Situación | Manejo |
|---|---|
| Shadow DOM | Se intenta `pierce` selector con Playwright. Si falla, se notifica al usuario que el elemento no es accesible directamente. |
| Elementos dentro de iframes en la página objetivo | Se detectan y se intenta cambiar al frame correspondiente. |
| Contenido detrás de login | No se soporta en v1. Se muestra mensaje: "Esta página requiere autenticación." |
| Scroll infinito | Solo se captura el contenido visible en el primer viewport + un scroll. |
| Sitios con bloqueo anti-bot | Playwright usa un perfil real de Chromium. Si el sitio bloquea igualmente, se muestra error con sugerencia de revisar la URL. |

### Seguridad

- Solo se permiten URLs con protocolo `https://` o `http://`. Se rechazan protocolos como `file://`, `data://`, `javascript:`.
- El HTML capturado se sanitiza antes de enviarse a Anthropic: se eliminan scripts, iframes embebidos y atributos de evento (`onclick`, `onerror`, etc.).
- El navegador controlado por Playwright corre en un proceso aislado sin acceso a la red interna del servidor.
- Se establece un timeout máximo de 30 segundos para la carga de cualquier página. Si supera ese tiempo, la sesión se termina y se notifica al usuario.
- El número de sesiones de navegador simultáneas se limita a N (configurable por variable de entorno `MAX_BROWSER_SESSIONS`, por defecto 3).

---

## Integración con el editor de plantillas existente

Esta funcionalidad no reemplaza el editor manual. Lo complementa. El flujo de integración es:

```
UrlNodeEditor
    │
    ├── [Input URL]  +  [Abrir selector visual ↗]
    │
    │   (Si el usuario usa el selector visual)
    │
    ▼
Panel de selector visual (modal fullscreen)
    │
    │  Modo manual o Modo IA
    │
    ▼
Campos generados / capturados
    │
    │  Al confirmar →
    │
    ▼
Los FieldEditors del UrlNodeEditor se rellenan automáticamente
con los nombres y selectores generados.

El usuario puede seguir editando los campos manualmente
después de confirmar (el editor queda completamente editable).
```

Los campos de tipo `url` detectados por la IA o seleccionados manualmente se marcan automáticamente con `is_child_url = true`, lo que habilita el botón "Crear sección hija" en el `FieldEditor` correspondiente.

---

## Estado del desarrollo

| Módulo | Estado |
|---|---|
| Diseño y documentación | ✓ Completo |
| Backend: sesión Playwright por WebSocket | Pendiente |
| Backend: inyección de script de selección | Pendiente |
| Backend: screenshot polling | Pendiente |
| Backend: integración Anthropic API | Pendiente |
| Backend: validación de selectores | Pendiente |
| Frontend: panel de selector visual | Pendiente |
| Frontend: modo manual (captura por clic) | Pendiente |
| Frontend: modo IA (revisión de campos) | Pendiente |
| Frontend: validación y preview de resultados | Pendiente |
| Testing end-to-end | Pendiente |

---

## Extensiones futuras

- **Auto-detección sin intervención:** La IA analiza la página completa y genera la plantilla entera (incluyendo nodos hijos) sin ningún clic del usuario.
- **Librería de plantillas reutilizables:** Las plantillas generadas para sitios populares se pueden guardar y compartir entre usuarios del sistema.
- **Modelos especializados:** Entrenar o ajustar modelos propios sobre un dataset de pares HTML → selector para mejorar la precisión en el dominio inmobiliario.
- **Detección de paginación automática:** La IA identifica el patrón de paginación del sitio (numérica, "Ver más", scroll infinito) y lo configura automáticamente en la plantilla.
- **Re-entrenamiento basado en feedback:** Cuando el usuario corrige un selector generado por IA, esa corrección se almacena como par de entrenamiento para mejorar futuras generaciones.
```