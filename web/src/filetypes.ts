export interface FileType {
  label: string
  kind: string
}

const TYPES: Record<string, FileType> = {
  java: { label: 'J', kind: 'java' },
  kt: { label: 'K', kind: 'kotlin' },
  kts: { label: 'K', kind: 'kotlin' },
  scala: { label: 'S', kind: 'scala' },
  groovy: { label: 'G', kind: 'groovy' },
  go: { label: 'GO', kind: 'go' },
  py: { label: 'Py', kind: 'python' },
  rs: { label: 'R', kind: 'rust' },
  ts: { label: 'TS', kind: 'typescript' },
  tsx: { label: 'TS', kind: 'typescript' },
  js: { label: 'JS', kind: 'javascript' },
  jsx: { label: 'JS', kind: 'javascript' },
  mjs: { label: 'JS', kind: 'javascript' },
  cjs: { label: 'JS', kind: 'javascript' },
  json: { label: '{}', kind: 'json' },
  yaml: { label: 'Y', kind: 'yaml' },
  yml: { label: 'Y', kind: 'yaml' },
  toml: { label: 'T', kind: 'yaml' },
  xml: { label: '<>', kind: 'xml' },
  html: { label: '<>', kind: 'html' },
  vue: { label: 'V', kind: 'vue' },
  svelte: { label: 'S', kind: 'svelte' },
  css: { label: '#', kind: 'css' },
  scss: { label: '#', kind: 'css' },
  less: { label: '#', kind: 'css' },
  sql: { label: 'SQL', kind: 'sql' },
  md: { label: 'M', kind: 'markdown' },
  markdown: { label: 'M', kind: 'markdown' },
  sh: { label: '>_', kind: 'shell' },
  bash: { label: '>_', kind: 'shell' },
  zsh: { label: '>_', kind: 'shell' },
  fish: { label: '>_', kind: 'shell' },
  c: { label: 'C', kind: 'c' },
  h: { label: 'H', kind: 'c' },
  cc: { label: 'C+', kind: 'cpp' },
  cpp: { label: 'C+', kind: 'cpp' },
  hpp: { label: 'H+', kind: 'cpp' },
  cs: { label: 'C#', kind: 'csharp' },
  php: { label: 'P', kind: 'php' },
  rb: { label: 'Rb', kind: 'ruby' },
  swift: { label: 'S', kind: 'swift' },
  dart: { label: 'D', kind: 'dart' },
  lua: { label: 'L', kind: 'lua' },
  r: { label: 'R', kind: 'r' },
  proto: { label: 'P', kind: 'proto' },
  gradle: { label: 'G', kind: 'groovy' },
  properties: { label: 'P', kind: 'config' },
  conf: { label: 'C', kind: 'config' },
  ini: { label: 'I', kind: 'config' },
  dockerfile: { label: 'D', kind: 'docker' },
  makefile: { label: 'M', kind: 'make' },
}

const SPECIAL: Record<string, FileType> = {
  Dockerfile: TYPES.dockerfile,
  Makefile: TYPES.makefile,
  Jenkinsfile: TYPES.groovy,
  Gemfile: TYPES.ruby,
  package: TYPES.json,
}

export function fileTypeOf(path: string): FileType {
  const name = path.slice(path.lastIndexOf('/') + 1)
  if (SPECIAL[name]) return SPECIAL[name]
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
  return TYPES[ext] ?? { label: '·', kind: 'file' }
}
