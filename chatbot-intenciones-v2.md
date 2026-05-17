# Chatbot Inmobiliario V2: Intenciones y Flujos

## 1. Resumen

Este documento redefine el flujo conversacional del chatbot con arquitectura por intenciones, preferencias V2 y contexto consolidado persistente.

Objetivos clave:
- Preferencias limitadas a 6 parámetros con modo por campo (`preferencia` | `obligatorio`).
- Presupuesto persistente fuera de preferencias (en `context`).
- Un solo chat activo por usuario autenticado.
- Rehidratación de contexto por resumen + señales clave (no historial completo).

---

## 2. Contrato Canónico de Preferencias V2

```json
{
  "ubicacion": { "modo": "preferencia|obligatorio", "valor": "string|null" },
  "zonas_cercanas": { "modo": "preferencia|obligatorio", "valor": ["string"] },
  "areas_comunes": { "modo": "preferencia|obligatorio", "valor": ["string"] },
  "habitaciones": { "modo": "preferencia|obligatorio", "valor": { "tipo": "exacto|rango", "exacto": 0, "min": 0, "max": 0 } },
  "banos": { "modo": "preferencia|obligatorio", "valor": { "tipo": "exacto|rango", "exacto": 0, "min": 0, "max": 0 } },
  "metros_cuadrados": { "modo": "preferencia|obligatorio", "valor": { "tipo": "exacto|rango", "exacto": 0, "min": 0, "max": 0 } }
}
```

Reglas de matching:
- `obligatorio`: filtro duro.
- `preferencia`: señal de ranking.
- `sin valor`: no aplica.

---

## 3. Contexto Adicional Persistente

Se guarda en `context` (separado de `preferences`):

```json
{
  "budget_context": {
    "min": 0,
    "max": 0,
    "currency": "PEN",
    "strictness": "preferencia|obligatorio"
  },
  "lead_profile": {
    "full_name": null,
    "country": null,
    "whatsapp": null,
    "document": null
  },
  "behavior_signals": {
    "viewed_record_ids": [],
    "rated_record_ids": [],
    "interested_record_ids": [],
    "discarded_record_ids": []
  },
  "conversation_memory": {
    "last_intent": null,
    "last_search_description": null,
    "ajustes_aceptados": [],
    "ajustes_rechazados": []
  }
}
```

---

## 4. Catálogo de Intenciones y Flujo por Intención

Cada intención sigue: `disparadores -> validaciones -> acciones -> persistencia -> transición`.

### 4.1 `inicio_busqueda`
- Disparadores: descripción inicial de búsqueda.
- Validaciones: mensaje in-scope y criterios extraíbles.
- Acciones: extraer criterios, detectar modos, buscar propiedades.
- Persistencia: actualiza `preferences` + `context`.
- Transición: `collecting_info -> presenting`.

### 4.2 `continuar_con_contexto`
- Disparadores: usuario autenticado con contexto previo.
- Validaciones: existe `preferences/context` consolidado.
- Acciones: saludo con resumen y opciones de continuación.
- Persistencia: registra `last_intent`.
- Transición: `collecting_info` (step de continuidad).

### 4.3 `ver_propiedades_nuevas_no_vistas`
- Disparadores: “1”, “nuevas”, “no vistas”.
- Validaciones: usuario autenticado + historial de vistas.
- Acciones: excluye vistas/descartadas y muestra resultados.
- Persistencia: mantiene modo de lista en sesión.
- Transición: `collecting_info -> presenting`.

### 4.4 `ver_propiedades_vistas`
- Disparadores: “2”, “vistas”, “anteriores”.
- Validaciones: historial de vistas disponible.
- Acciones: recupera vistas por ranking histórico.
- Persistencia: modo de lista “vistas”.
- Transición: `collecting_info -> presenting`.

### 4.5 `ajustar_criterios_busqueda`
- Disparadores: “ajustar”, “cambiar filtros”, nuevos parámetros.
- Validaciones: entrada con cambios concretos o solicitud genérica.
- Acciones: recolecta/actualiza criterios y relanza búsqueda.
- Persistencia: actualiza `preferences/context` con ajuste.
- Transición: `presenting|collecting_info -> collecting_info(step ajuste) -> presenting`.

### 4.6 `confirmar_relajacion_resultados`
- Disparadores: no hay exactos y sistema propone alternativas.
- Validaciones: existen alternativas relajadas.
- Acciones: confirmar mostrar alternativas o pedir ajuste.
- Persistencia: guarda decisión en `conversation_memory`.
- Transición: `collecting_info(step relajación) -> presenting|collecting_info`.

### 4.7 `ver_siguiente_propiedad`
- Disparadores: “siguiente”, “otra”, “skip”.
- Validaciones: lista actual vigente.
- Acciones: avanza índice; si se agota, ofrece nuevas acciones.
- Persistencia: señal de navegación.
- Transición: `presenting -> presenting|collecting_info`.

### 4.8 `calificar_propiedad`
- Disparadores: `1..5` estrellas.
- Validaciones: propiedad actual disponible.
- Acciones: guarda rating, adapta feedback conversacional.
- Persistencia: `rated_record_ids` y descartes (`<=2`).
- Transición: `presenting`.

### 4.9 `marcar_interes_lo_quiero`
- Disparadores: “lo quiero”, “me interesa”.
- Validaciones: propiedad actual disponible.
- Acciones: marca interés y activa flujo de contacto.
- Persistencia: `interested_record_ids` + lead parcial.
- Transición: `presenting -> collecting_info(contacto)|contact_requested`.

### 4.10 `capturar_datos_contacto`
- Disparadores: flujo abierto por interés.
- Validaciones: campos faltantes (país, nombre, whatsapp, documento).
- Acciones: completar datos, normalizar y notificar asesor.
- Persistencia: `lead_profile` consolidado.
- Transición: `collecting_info -> contact_requested -> collecting_info`.

### 4.11 `consultar_detalle_propiedad_actual`
- Disparadores: pregunta sobre propiedad mostrada.
- Validaciones: existe propiedad en foco.
- Acciones: responder con datos reales del card/contexto.
- Persistencia: sin mutación crítica (solo memoria breve si aplica).
- Transición: `presenting`.

### 4.12 `fallback_fuera_de_alcance`
- Disparadores: mensaje out-of-scope.
- Validaciones: sin señales inmobiliarias.
- Acciones: redirige a capacidades del bot.
- Persistencia: registra intento en memoria breve.
- Transición: mantiene estado actual.

### 4.13 `fallback_no_entendido`
- Disparadores: intención ambigua/no clasificable.
- Validaciones: sin parseo confiable.
- Acciones: pedir aclaración accionable.
- Persistencia: `last_intent=fallback_no_entendido`.
- Transición: mantiene estado actual.

---

## 5. Política de Sesiones

### Usuario autenticado
- Al crear nueva sesión:
  1. Cerrar sesiones activas previas (`is_active=false`, estado `inactivo`).
  2. Crear sesión limpia nueva.
  3. Rehidratar solo contexto consolidado.
- No se reabre historial completo de mensajes.

### Usuario anónimo
- Siempre se crea chat nuevo.
- No hay rehidratación de contexto entre visitas.

---

## 6. Contratos API/Tipos (V2)

### `POST /chat/web/sessions`
- Respuesta:
  - `session_id`
  - `state`
  - `rehydrated` (bool)
  - `context_summary` (string)
  - `message`
  - `card`
  - `quick_replies`

### `GET /preferences/me`
- Respuesta:
  - `preferences` (V2)
  - `context`
  - `preferences_updated_at`
  - `interactions`
  - `search_history`

### `GET /site-users/{id}/profile`
- Respuesta:
  - `user`
  - `lead`
  - `preferences` (V2)
  - `context`
  - `preferences_updated_at`
  - `interactions`
  - `search_history`

---

## 7. Plan de Pruebas

- Clasificación de intención: 1 set por cada intención (13) + casos ambiguos.
- Flujos por estado: `collecting_info`, `presenting`, `contact_requested`.
- Matching:
  - `obligatorio` como hard filter.
  - `preferencia` como ranking.
- Sesión activa única:
  - usuario autenticado abre chat nuevo y cierra anterior.
  - usuario anónimo abre chat nuevo sin rehidratación.
- Persistencia de contexto:
  - `preferences` V2.
  - `budget_context` separado.
  - señales de comportamiento y resumen conversacional.

