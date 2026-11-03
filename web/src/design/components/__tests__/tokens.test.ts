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
