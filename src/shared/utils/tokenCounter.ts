// Rough token estimate: ~4 chars per token for English prose, ~3 for code
export function estimateTokens(text: string): number {
  if (!text) return 0
  const codeMatches = text.match(/```[\s\S]*?```/g) ?? []
  const codeChars = codeMatches.reduce((acc, m) => acc + m.length, 0)
  const proseChars = text.length - codeChars
  return Math.ceil(codeChars / 3 + proseChars / 4)
}

export function formatTokenCount(tokens: number): string {
  if (tokens < 1000) return `${tokens}`
  return `${(tokens / 1000).toFixed(1)}k`
}
