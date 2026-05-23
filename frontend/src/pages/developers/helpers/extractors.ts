export function pick(data: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = data[k]
    if (v !== null && v !== undefined && typeof v !== 'object') {
      const s = String(v).trim()
      if (s && s.toLowerCase() !== 'null') return s
    }
  }
  return ''
}

// "monet-jesus-maria" → "Monet Jesus Maria"  (ignores generic path segments)
function titleFromUrlSlug(url: string): string {
  try {
    const SKIP = new Set(['proyecto', 'projects', 'propiedad', 'property', 'venta', 'sale', 'en-venta', 'departamentos'])
    const parts = new URL(url).pathname.split('/').filter(p => p && !SKIP.has(p.toLowerCase()))
    const slug  = parts[parts.length - 1]
    if (slug) return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  } catch { /* invalid url */ }
  return ''
}

// "TIPO 1 / 59 m2 / 1 dorms / 2 baños" → "Tipo 1"
function tipoFromModelo(d: Record<string, unknown>): string {
  const m = pick(d, ['modelo'])
  if (!m) return ''
  const match = m.match(/^(TIPO\s+\S+)/i)
  return match ? match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase() : ''
}

// Parses "TIPO 1 / 59 m2 / 1 dorms / 2 baños" → { area, dorms, baths }
function parseModelo(d: Record<string, unknown>) {
  const m = pick(d, ['modelo'])
  if (!m) return {}
  return {
    area:  m.match(/(\d+(?:[.,]\d+)?)\s*m2/i)?.[1],
    dorms: m.match(/(\d+)\s*dorms?/i)?.[1],
    baths: m.match(/(\d+)\s*ba[ñn]os?/i)?.[1],
  }
}

export function extractTitle(d: Record<string, unknown>): string {
  // 1. Standard name fields
  const direct = pick(d, ['nombre', 'name', 'titulo', 'title', 'proyecto', 'project_name', 'nombre_proyecto'])
  if (direct) return direct
  // 2. "Tipo 1" from modelo (unit records)
  const tipo = tipoFromModelo(d)
  if (tipo) return tipo
  // 3. Project name from url_propiedad slug (project records)
  const urlField = pick(d, ['url_propiedad', 'url_proyecto', 'url', 'link', 'href'])
  if (urlField) {
    const fromUrl = titleFromUrlSlug(urlField)
    if (fromUrl) return fromUrl
  }
  return '—'
}

export function extractLocation(d: Record<string, unknown>) {
  return pick(d, ['ubicación', 'ubicacion', 'location', 'distrito', 'ciudad', 'zona', 'direccion', 'barrio'])
}

export function extractStatus(d: Record<string, unknown>) {
  return pick(d, ['estado_del_proyecto', 'estado del proyecto', 'estado', 'estado_proyecto', 'status', 'disponibilidad', 'estado_disponibilidad'])
}

export function extractBedrooms(d: Record<string, unknown>): string {
  const v = pick(d, ['dormitorios', 'habitaciones', 'cuartos', 'bedrooms', 'dorms', 'num_dormitorios'])
  return v || parseModelo(d).dorms || ''
}

export function extractBathrooms(d: Record<string, unknown>): string {
  const v = pick(d, ['banos', 'baños', 'bathrooms', 'wc', 'num_banos'])
  return v || parseModelo(d).baths || ''
}

export function extractModel(d: Record<string, unknown>) {
  return pick(d, ['modelo', 'tipologia_modelo', 'model', 'tipo_modelo'])
}

export function extractDesc(d: Record<string, unknown>) {
  return pick(d, ['descripción', 'descripcion', 'description', 'resumen', 'detalle', 'acerca'])
}

export function extractPropType(d: Record<string, unknown>): string {
  const v = pick(d, ['tipo', 'tipo_propiedad', 'type', 'property_type', 'tipologia', 'tipo_unidad'])
  if (v) return v
  const tipo = tipoFromModelo(d)
  return tipo
}

export function extractPropId(d: Record<string, unknown>, id: string) {
  return pick(d, ['property_identifier', 'property_id', 'id_propiedad', 'codigo_propiedad', 'codigo', 'id_unidad', 'sku', 'code']) || id.slice(0, 8)
}

export function extractPrice(d: Record<string, unknown>): string {
  const raw = pick(d, ['precio desde', 'precio_desde', 'precio', 'price', 'costo', 'precio_min', 'precio_venta', 'valor', 'rango_precio'])
  if (!raw) return ''
  if (/S\/|USD|\$|PEN/i.test(raw)) return raw
  const n = parseFloat(raw.replace(/[^\d.]/g, ''))
  if (!isNaN(n) && n > 0) return `S/ ${n.toLocaleString('es-PE')}`
  // Si no tiene dígitos ni símbolo de moneda, no es un precio válido
  if (!/\d/.test(raw)) return ''
  return raw
}

export function extractArea(d: Record<string, unknown>): string {
  const raw = pick(d, ['area_m2', 'area', 'm2', 'metros_cuadrados', 'metraje', 'superficie', 'area_total', 'area_techada'])
  if (raw) {
    if (/m2|m²/i.test(raw)) return raw
    const n = parseFloat(raw.replace(/[^\d.]/g, ''))
    if (!isNaN(n) && n > 0) return `${n} m²`
  }
  const fromModelo = parseModelo(d).area
  return fromModelo ? `${fromModelo} m²` : ''
}

export function extractTags(d: Record<string, unknown>, keys: string[]): string[] {
  for (const k of keys) {
    const v = d[k]
    if (Array.isArray(v) && v.length > 0) return v.map(String).filter(Boolean)
    if (typeof v === 'string' && v.trim()) return v.split(/[,;|]/).map(s => s.trim()).filter(Boolean)
  }
  return []
}

export function statusClass(s: string) {
  const t = (s || '').toLowerCase()
  if (t.includes('complet') || t.includes('disponib') || t.includes('inmediata') || t.includes('entrega')) return 'bg-green-100 text-green-700'
  if (t.includes('parcial') || t.includes('preventa') || t.includes('construc') || t.includes('próx') || t.includes('prox')) return 'bg-yellow-100 text-yellow-700'
  if (t.includes('error') || t.includes('agotad') || t.includes('vendid'))       return 'bg-red-100 text-red-700'
  return 'bg-gray-100 text-gray-600'
}

export function recordStatusLabel(s: string) {
  return s === 'success' ? 'Completo' : s === 'partial' ? 'Parcial' : 'Error'
}
