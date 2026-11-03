// @vitest-environment jsdom
import '../../test-utils'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { Button } from '..'

describe('Button as link', () => {
  it('renders a router link with button classes and navigates', async () => {
    render(<MemoryRouter initialEntries={['/a']}><Routes>
      <Route path="/a" element={<Button as="link" to="/b" variant="primary" size="sm">Upload report</Button>} />
      <Route path="/b" element={<p>page b</p>} />
    </Routes></MemoryRouter>)
    const a = screen.getByRole('link', { name: 'Upload report' })
    expect(a.getAttribute('href')).toBe('/b')
    expect(a.className).toContain('ds-btn--primary')
    expect(a.className).toContain('ds-btn--sm')
    await userEvent.click(a)
    expect(screen.getByText('page b')).toBeTruthy()
  })
  it('disabled link is not a link and not focusable', () => {
    render(<MemoryRouter><Button as="link" to="/b" disabled>Publish</Button></MemoryRouter>)
    expect(screen.queryByRole('link')).toBeNull()
    const el = screen.getByText('Publish')
    expect(el.getAttribute('aria-disabled')).toBe('true')
    expect(el.className).toContain('ds-btn--disabled')
  })
  it('as="a" renders a plain anchor', () => {
    render(<Button as="a" href="/files/x.pdf" download>Download PDF</Button>)
    const a = screen.getByRole('link', { name: 'Download PDF' })
    expect(a.getAttribute('href')).toBe('/files/x.pdf')
    expect(a.hasAttribute('download')).toBe(true)
  })
})
