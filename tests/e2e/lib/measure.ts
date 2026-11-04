import fs from 'node:fs'
import path from 'node:path'
import { CACHE } from './env'

/** Measured values for the acceptance table in docs/demo.md (extraction time, timings). One JSON line each. */
const FILE = path.join(CACHE, 'measurements.jsonl')

export function record(kind: string, data: Record<string, unknown>) {
  fs.mkdirSync(CACHE, { recursive: true })
  fs.appendFileSync(FILE, JSON.stringify({ kind, at: new Date().toISOString(), ...data }) + '\n')
}
export function resetMeasurements() {
  fs.mkdirSync(CACHE, { recursive: true })
  fs.writeFileSync(FILE, '')
}
