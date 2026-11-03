/** Imported by every Design System test: registers testing-library cleanup (vitest globals are off in this repo). */
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
afterEach(() => cleanup())
