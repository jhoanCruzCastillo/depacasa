# Intenciones del Chatbot

El chatbot usa un motor de intenciones basado en estados (`collecting_info`, `presenting`, `contact_requested`). Claude clasifica el mensaje del usuario entre las intenciones candidatas para el estado actual, y se ejecutan en orden hasta producir una respuesta.

---

## Intenciones de búsqueda

### `inicio_busqueda`
Inicia o reinicia una búsqueda de propiedades con la descripción libre del usuario. Activa el motor de matchmaking (paso 5). Funciona desde cualquier estado cuando el mensaje claramente describe qué busca el usuario.

### `ajustar_criterios_busqueda`
El usuario quiere cambiar los parámetros de búsqueda (zona, dormitorios, presupuesto). El bot pide los nuevos parámetros antes de re-ejecutar la búsqueda. Disponible desde `presenting`, `contact_requested` y `collecting_info`.

### `filtro_exacto_propiedades`
Aplica un filtro preciso sin reformular la búsqueda:
- **by_id** — Muestra una propiedad exacta por UUID. Si interrumpe una lista activa, la suspende y ofrece retomarla.
- **by_rating** — Filtra las propiedades calificadas por el usuario (ej. "las que di muchas estrellas").
- **no_price** — Muestra propiedades sin precio publicado.

---

## Intenciones de navegación de resultados

### `ver_siguiente_propiedad`
Avanza al siguiente ítem de la lista de resultados cuando el usuario dice "siguiente", "otra", etc. Solo activo en estado `presenting`.

### `consultar_detalle_propiedad_actual`
Vuelve a mostrar la tarjeta completa de la propiedad actual cuando el usuario pide más detalles. Solo en `presenting`.

### `continuar_con_contexto`
En el paso de retoma (paso 8), si el usuario responde afirmativamente ("sí", "dale") y ya hay criterios guardados, retoma la búsqueda anterior sin pedirle parámetros de nuevo.

### `confirmar_relajacion_resultados`
Solo en el paso 6 (sin resultados exactos). El bot ofreció resultados con criterios relajados:
- Afirmativo → muestra los resultados relajados.
- Nueva búsqueda → reinicia el matchmaking.
- Otro → mantiene los filtros actuales y pide ajuste.

---

## Intenciones de historial del usuario

### `ver_propiedades_vistas`
Muestra las propiedades que el usuario ya vio, ordenadas por interacción. También responde a "mis propiedades de interés" mostrando las marcadas como favoritas. Requiere usuario registrado.

### `ver_propiedades_nuevas_no_vistas`
Aplica un filtro `_result_mode: "new_unseen"` a los criterios actuales para mostrar solo propiedades que el usuario aún no ha visto. Requiere usuario registrado.

---

## Intenciones de interacción con propiedad

### `calificar_propiedad`
Registra la calificación de 1–5 estrellas que el usuario da a la propiedad actual. Si además pide "siguiente", encadena la calificación como preludio y continúa al siguiente resultado.

### `marcar_interes_lo_quiero`
Marca la propiedad actual como "de interés" cuando el usuario expresa interés directo ("lo quiero", "me gusta", "contactar asesor"). Activa el flujo de captura de datos.

---

## Intenciones de captura de lead

### `capturar_datos_contacto`
Pasos 9 y 10: captura nombre, teléfono y correo del usuario para crear el lead. El usuario puede escapar en cualquier momento hacia una nueva búsqueda.

### `capturar_sustento_financiero`
Paso 12: pregunta al usuario qué tipo de respaldo financiero tiene (efectivo, crédito hipotecario pre-aprobado, etc.) para calificar el lead.

---

## Fallbacks

### `fallback_fuera_de_alcance`
Se activa cuando el mensaje no tiene relación con búsqueda inmobiliaria. Responde redirigiendo al usuario al propósito del chatbot.

### `fallback_no_entendido`
Catch-all final: cuando ninguna intención produce respuesta, genera una respuesta contextual para mantener la conversación y orientar al usuario.
