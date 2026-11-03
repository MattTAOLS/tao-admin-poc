/// <reference types="node" />
// Tokens only, never raw colours, in web/src/portfolio (same rule the Design System guards for its own folders).
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const dir = resolve(__dirname, '..')
const tokensCss = readFileSync(resolve(dir, '../../../contracts/tokens.css'), 'utf8')
const tokens = new Set([...tokensCss.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]))
const files = readdirSync(dir).filter(n => /\.(css|tsx|ts)$/.test(n)).map(n => join(dir, n))
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('portfolio uses tokens only', () => {
  it('finds its files', () => { expect(files.length).toBeGreaterThan(10) })
  for (const f of files) {
    const src = strip(readFileSync(f, 'utf8'))
    it(`${f.slice(dir.length + 1)} has no raw colours and only known tokens`, () => {
      const raw = [
        ...src.matchAll(/#[0-9a-fA-F]{3,8}\b(?![\w-])/g),
        ...src.matchAll(/\brgba?\s*\(/g),
        ...src.matchAll(/\bhsla?\s*\(/g),
      ].map(m => m[0]).filter(h => !h.startsWith('#') || [4, 5, 7, 9].includes(h.length))
      expect(raw).toEqual([])
      const unknown = [...src.matchAll(/var\((--[a-z0-9-]+)/g)].map(m => m[1]).filter(v => !tokens.has(v))
      expect(unknown).toEqual([])
    })
  }
})
