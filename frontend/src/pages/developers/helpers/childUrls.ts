import { ScrapedRecord } from '../../../types'

export const isUrlValue  = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//i.test(v)
export const normalizeUrl = (v: string) => v.trim().replace(/\/+$/, '')

export function collectChildUrls(record: ScrapedRecord, fieldNames?: string[]): string[] {
  const urls: string[] = []
  const push = (v: unknown) => {
    if (isUrlValue(v)) { urls.push(v); return }
    if (Array.isArray(v)) v.forEach(push)
  }
  if (fieldNames?.length) fieldNames.forEach(n => push(record.data?.[n]))
  else Object.values(record.data || {}).forEach(push)
  return Array.from(new Set(urls.map(normalizeUrl))).filter(Boolean)
}
