/** A few DOM matchers for the wave C admin tests (the repo has no jest-dom). Import for its side effect. */
import { expect } from 'vitest'

interface DomMatchers<R = unknown> {
  toBeInTheDocument(): R
  toBeChecked(): R
  toBeDisabled(): R
  toHaveValue(v: string): R
  toHaveTextContent(t: string | RegExp): R
}
declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Assertion<T = any> extends DomMatchers<T> {}
  interface AsymmetricMatchersContaining extends DomMatchers {}
}

const el = (x: unknown) => x as HTMLInputElement
expect.extend({
  toBeInTheDocument(x: unknown) {
    const pass = !!x && (x as Node).isConnected === true
    return { pass, message: () => `expected element ${pass ? 'not ' : ''}to be in the document` }
  },
  toBeChecked(x: unknown) {
    const pass = el(x).checked === true
    return { pass, message: () => `expected checkbox ${pass ? 'not ' : ''}to be checked` }
  },
  toBeDisabled(x: unknown) {
    const pass = el(x).disabled === true || el(x).getAttribute?.('aria-disabled') === 'true'
    return { pass, message: () => `expected element ${pass ? 'not ' : ''}to be disabled` }
  },
  toHaveValue(x: unknown, v: string) {
    const pass = el(x).value === v
    return { pass, message: () => `expected value ${JSON.stringify(el(x).value)} ${pass ? 'not ' : ''}to be ${JSON.stringify(v)}` }
  },
  toHaveTextContent(x: unknown, t: string | RegExp) {
    const text = (x as Node).textContent ?? ''
    const pass = typeof t === 'string' ? text.includes(t) : t.test(text)
    return { pass, message: () => `expected text ${JSON.stringify(text)} ${pass ? 'not ' : ''}to contain ${String(t)}` }
  },
})
