export const MEDIA_BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api').replace(/\/api\/?$/, '')
export const toMediaUrl  = (p: string) => p.startsWith('/media/') ? `${MEDIA_BASE}${p}` : p
export const isMediaPath = (v: unknown): v is string => typeof v === 'string' && v.startsWith('/media/')

const IMG_EXT = /\.(jpe?g|png|webp|gif|avif|bmp|svg)(\?[^#]*)?$/i

export const looksLikeImage = (v: unknown): v is string =>
  isMediaPath(v) || (typeof v === 'string' && /^https?:\/\//i.test(v) && IMG_EXT.test(v.split('#')[0]))

export function heroImage(d: Record<string, unknown>): string | null {
  for (const v of Object.values(d)) {
    if (Array.isArray(v)) {
      const img = v.find(looksLikeImage)
      if (img) return isMediaPath(img) ? toMediaUrl(img) : img
    }
  }
  for (const v of Object.values(d)) {
    if (looksLikeImage(v)) return isMediaPath(v) ? toMediaUrl(v) : v
  }
  return null
}

export function allImages(d: Record<string, unknown>): string[] {
  const seen = new Set<string>()
  const out:  string[] = []
  const add = (v: unknown) => {
    if (!looksLikeImage(v)) return
    const url = isMediaPath(v) ? toMediaUrl(v) : v
    if (!seen.has(url)) { seen.add(url); out.push(url) }
  }
  Object.values(d).forEach(v => Array.isArray(v) ? v.forEach(add) : add(v))
  return out
}
