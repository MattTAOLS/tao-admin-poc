/// <reference types="node" />
// Guards the "tokens only, never raw colours" rule for everything the Design System owns, and checks that every
// var(--x) used resolves to a token in contracts/tokens.css (or a variable this library defines itself).
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const web = resolve(__dirname, '../../../..')
const tokensCss = readFileSync(resolve(web, '../contracts/tokens.css'), 'utf8')
const tokens = new Set([...tokensCss.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]))
const OWN_VARS = new Set(['--ds-sticky-top']) // set by the shell at runtime

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return n === '__tests__' ? [] : walk(p)
    return /\.(css|tsx|ts)$/.test(n) && !/\.(test|stories)\.tsx?$/.test(n) ? [p] : []
  })
}
const files = [...walk(resolve(web, 'src/design')), ...walk(resolve(web, 'src/shell'))]
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('tokens only', () => {
  it('finds the files it guards', () => { expect(files.length).toBeGreaterThan(10) })

  for (const f of files) {
    const rel = f.slice(web.length + 1).replace(/\\/g, '/')
    const src = strip(readFileSync(f, 'utf8'))
    it(`${rel} has no raw colours`, () => {
      const hits = [
        ...src.matchAll(/#[0-9a-fA-F]{3,8}\b(?![\w-])/g),
        ...src.matchAll(/\brgba?\s*\(/g),
        ...src.matchAll(/\bhsla?\s*\(/g),
        ...src.matchAll(/(?:color|background|border(?:-[a-z]+)?|fill|stroke)\s*:\s*['"]?(white|black|red|green|blue|gray|grey|purple|orange|yellow)\b/gi),
      ].map(m => m[0])
      // '#' followed by digits inside JSX text such as "#1" is not a colour; only flag hex-looking runs of 3, 4, 6 or 8.
      const real = hits.filter(h => !h.startsWith('#') || [4, 5, 7, 9].includes(h.length))
      expect(real, `raw colours in ${rel}`).toEqual([])
    })
    it(`${rel} only references defined tokens`, () => {
      const used = [...src.matchAll(/var\((--[a-z0-9-]+)/g)].map(m => m[1])
      const unknown = used.filter(v => !tokens.has(v) && !OWN_VARS.has(v))
      expect(unknown, `unknown CSS variables in ${rel}`).toEqual([])
    })
  }
})

// WCAG AA (4.5:1 for text under 18 px) for every text token on the surfaces it sits on.
describe('text contrast', () => {
  const val = (name: string) => {
    const m = new RegExp('(?:^|[ \t;{])' + name + '[ \t]*:[ \t]*(#[0-9a-fA-F]{6})', 'm').exec(tokensCss)
    if (!m) throw new Error('token not found: ' + name)
    return m[1]
  }
  const lum = (hex: string) => {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(x => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  }
  const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  const pairs: [string, string[]][] = [
    ['--muted', ['--cream', '--card', '--canvas-deep', '--lav']],
    ['--text', ['--cream', '--card', '--lav']],
    ['--ok', ['--ok-bg', '--cream', '--card']],
    ['--warn', ['--warn-bg', '--cream', '--card']],
    ['--bad', ['--bad-bg', '--cream', '--card']],
    ['--blue', ['--blue-bg', '--cream', '--card']],
    ['--dpv', ['--dpv-bg', '--cream', '--card']],
    ['--text-on-indigo', ['--indigo', '--indigo-2']],
    ['--text-on-indigo-muted', ['--indigo', '--indigo-2']],
  ]
  for (const [fg, bgs] of pairs) for (const bg of bgs) {
    it(`${fg} on ${bg} is at least 4.5:1`, () => { expect(ratio(val(fg), val(bg))).toBeGreaterThanOrEqual(4.5) })
  }
})
