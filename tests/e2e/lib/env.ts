import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Where the stack under test lives. Defaults are the plain `docker compose up` ports (web :5173, API :8000). */
export const WEB_URL = (process.env.E2E_WEB_URL ?? 'http://localhost:5173').replace(/\/$/, '')
export const API_URL = (process.env.E2E_API_URL ?? 'http://localhost:8000').replace(/\/$/, '') + '/api/v1'
export const E2E_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const REPO = path.resolve(E2E_DIR, '..', '..')
export const SAMPLES = process.env.E2E_SAMPLES ?? path.join(REPO, 'data', 'samples')
export const CACHE = path.join(E2E_DIR, '.cache')
export const SHOTS = path.join(REPO, 'docs', 'demo')
export const PYTHON = process.env.E2E_PYTHON ?? 'python'
/** Upload to needs_review budget: the acceptance criterion is under 3 minutes. */
export const EXTRACT_BUDGET_MS = 180_000
