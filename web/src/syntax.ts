import hljs from 'highlight.js/lib/common'

const LANG_BY_EXT: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  go: 'go', py: 'python', rs: 'rust', java: 'java', kt: 'kotlin', kts: 'kotlin', swift: 'swift',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash', json: 'json', yaml: 'yaml', yml: 'yaml',
  css: 'css', scss: 'scss', less: 'less', html: 'xml', vue: 'xml', svelte: 'xml', xml: 'xml',
  md: 'markdown', markdown: 'markdown', sql: 'sql', toml: 'ini', ini: 'ini', conf: 'ini',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php', rb: 'ruby',
  dockerfile: 'dockerfile', makefile: 'makefile', gradle: 'groovy', lua: 'lua', r: 'r', dart: 'dart',
}

const SPECIAL_NAMES: Record<string, string> = {
  Dockerfile: 'dockerfile', Makefile: 'makefile', Jenkinsfile: 'groovy', Gemfile: 'ruby',
}

export function languageOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  if (SPECIAL_NAMES[name]) return SPECIAL_NAMES[name]
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
  return LANG_BY_EXT[ext] ?? 'plaintext'
}

export interface SyntaxSegment {
  text: string
  className?: string
}

function enrichSQL(segments: SyntaxSegment[]): SyntaxSegment[] {
  const out: SyntaxSegment[] = []
  for (const segment of segments) {
    if (segment.className?.includes('hljs-comment') || segment.className?.includes('hljs-string')) {
      out.push(segment)
      continue
    }
    if (segment.className) {
      out.push(segment)
      continue
    }
    const pattern = /(#\{[^}]+\}|:[A-Za-z_]\w*)|([A-Za-z_]\w*(?=\s*\())/g
    let last = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(segment.text))) {
      if (match.index > last) out.push({ text: segment.text.slice(last, match.index) })
      out.push({
        text: match[0],
        className: match[1] ? 'hljs-variable' : 'hljs-function',
      })
      last = match.index + match[0].length
    }
    if (last < segment.text.length) out.push({ text: segment.text.slice(last) })
  }
  return out
}

const segmentCache = new Map<string, SyntaxSegment[]>()
const MAX_CACHE = 4000

function decodeHtml(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|#39);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const hex = entity[1]?.toLowerCase() === 'x'
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    switch (entity.toLowerCase()) {
      case 'amp': return '&'
      case 'lt': return '<'
      case 'gt': return '>'
      case 'quot': return '"'
      case '39': return "'"
      default: return match
    }
  })
}

function tokenizeHighlighted(html: string): SyntaxSegment[] {
  const out: SyntaxSegment[] = []
  const stack: string[] = []
  const push = (text: string) => {
    if (!text) return
    const className = stack.length ? stack.join(' ') : undefined
    const last = out[out.length - 1]
    if (last && last.className === className) last.text += text
    else out.push({ text, className })
  }
  const tag = /<span class="([^"]+)">|<\/span>|([^<]+)/g
  let match: RegExpExecArray | null
  while ((match = tag.exec(html))) {
    if (match[1]) stack.push(match[1])
    else if (match[0] === '</span>') stack.pop()
    else if (match[2]) push(decodeHtml(match[2]))
  }
  return out
}

export function syntaxSegments(text: string, language: string): SyntaxSegment[] {
  if (!text || !language || language === 'plaintext') return [{ text }]
  const key = `${language}\u0000${text}`
  const cached = segmentCache.get(key)
  if (cached) return cached
  let segments: SyntaxSegment[]
  try {
    segments = tokenizeHighlighted(hljs.highlight(text, { language, ignoreIllegals: true }).value)
    if (language === 'sql') segments = enrichSQL(segments)
  } catch {
    segments = [{ text }]
  }
  if (segmentCache.size > MAX_CACHE) segmentCache.clear()
  segmentCache.set(key, segments)
  return segments
}
