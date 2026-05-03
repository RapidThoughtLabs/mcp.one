import { encode } from 'gpt-tokenizer/esm/encoding/cl100k_base'

const cache = new Map<string, number>()

export function countTokens(text: string): number {
  const cached = cache.get(text)
  if (cached !== undefined) return cached
  const count = encode(text).length
  cache.set(text, count)
  return count
}

export function countJsonTokens(value: unknown): number {
  return countTokens(JSON.stringify(value, null, 2))
}

export function formatTokenCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}
