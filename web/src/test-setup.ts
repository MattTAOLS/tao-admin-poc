// Vitest setup (vite.config.ts test.setupFiles). Testing Library's findBy* and waitFor give up after 1 s by default; under a
// loaded machine (several agents running suites at once) lazy pages took longer and tests failed at random. 5 s here,
// inside the 30 s test timeout.
import { configure } from '@testing-library/dom'

configure({ asyncUtilTimeout: 5_000 })
