// @vitest-environment jsdom
import '@/design/test-utils'
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { App, matchPath } from '@/shell/App'
import { KEY, ROLES, type Role } from '@/shell/roles'
import { ADMIN_PAGES, PARTNER_PAGES, type Page } from '@/shell/pages'
import { headerStore } from '@/shell/header'
import { ToastProvider } from '@/design/components'
import { HelpView, contentFor, forRole, linkTargets, matchesSection, parseInline, resolveLink, GLOSSARY_ID, type HelpShell } from '../HelpPage'
import { ADMIN_HELP, PARTNER_HELP } from '../content'

beforeEach(() => { localStorage.clear(); headerStore.clear() })

function renderView(shell: HelpShell, role: Role, path = shell === 'admin' ? '/admin/help' : `/${shell}/help`) {
  return render(<MemoryRouter initialEntries={[path]}><ToastProvider><HelpView shell={shell} role={role} /></ToastProvider></MemoryRouter>)
}
const sectionTitles = () => screen.getAllByRole('region').map(r => r.getAttribute('aria-labelledby')).filter(Boolean)
  .map(id => document.getElementById(id!)?.textContent)

describe('help pages render through the shell', () => {
  it('opens /admin/help for TAO Admin from the sidebar registry', async () => {
    localStorage.setItem(KEY, 'tao_admin')
    render(<MemoryRouter initialEntries={['/admin/help']}><App /></MemoryRouter>)
    expect(await screen.findByRole('heading', { level: 2, name: 'Approve and publish' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: 'Help & support' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'What the words mean' })).toBeTruthy()
  })
  it('opens /investor/help for an investor viewer, named for the portal', async () => {
    localStorage.setItem(KEY, 'investor_viewer')
    render(<MemoryRouter initialEntries={['/investor/help']}><App /></MemoryRouter>)
    expect(await screen.findByRole('heading', { level: 2, name: 'Read covenant status' })).toBeTruthy()
    expect(screen.getByText('What the Investor Portal shows and how to read it.')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Approve and publish' })).toBeNull()
  })
  it('opens /manager/help for a manager role', async () => {
    localStorage.setItem(KEY, 'manager_viewer')
    render(<MemoryRouter initialEntries={['/manager/help']}><App /></MemoryRouter>)
    expect(await screen.findByRole('heading', { level: 2, name: 'When new numbers appear' })).toBeTruthy()
    expect(screen.getByText(/The Manager Portal shows the programs TAO has published/)).toBeTruthy()
  })
  it('marks both help pages built with a loader', () => {
    for (const p of [ADMIN_PAGES.find(x => x.path === '/admin/help'), PARTNER_PAGES.find(x => x.path === '/help')]) {
      expect(p?.built).toBe(true); expect(typeof p?.load).toBe('function')
    }
  })
})

describe('role filtering', () => {
  it('shows TAO Admin the decision sections and no analyst caveats', () => {
    renderView('admin', 'tao_admin')
    const titles = sectionTitles()
    for (const t of ['Resolve a finding', 'Re-extract pages', 'Approve and publish', 'Reject a report', 'Check the audit log']) expect(titles).toContain(t)
    expect(screen.getByText(/You are TAO Admin\./)).toBeTruthy()
    expect(screen.queryByText(/You are TAO Analyst\./)).toBeNull()
    expect(screen.getByText(/Regenerate dashboard…/)).toBeTruthy()
  })
  it('hides admin-only sections and steps from TAO Analyst and says what they cannot do', () => {
    renderView('admin', 'tao_analyst')
    const titles = sectionTitles()
    for (const t of ['Resolve a finding', 'Re-extract pages', 'Approve and publish', 'Reject a report', 'Check the audit log']) expect(titles).not.toContain(t)
    for (const t of ['Upload a settlement report', 'Review a report', 'Re-issue a corrected report for a published month', 'Testing the portal']) expect(titles).toContain(t)
    expect(screen.getByText(/You cannot resolve findings/)).toBeTruthy()
    expect(screen.queryByText(/Regenerate dashboard…/)).toBeNull()
    expect(screen.getByText(/A TAO Admin sees the exact reason/)).toBeTruthy()
    expect(screen.getByText('Showing help for TAO Analyst.', { exact: false })).toBeTruthy()
  })
  it('shows the Team members note only to partner company admins', () => {
    renderView('manager', 'manager_admin')
    expect(screen.getByText(/Team members, shown to Company Admin roles/)).toBeTruthy()
    screen.getByText('Showing help for Manager · Company Admin.', { exact: false })
    document.body.innerHTML = ''
    renderView('manager', 'manager_viewer')
    expect(screen.queryByText(/Team members, shown to Company Admin roles/)).toBeNull()
  })
  it('drops sections that end up empty for a role', () => {
    const analyst = forRole(ADMIN_HELP, 'tao_analyst')
    for (const s of analyst.sections) expect(Boolean(s.intro || s.steps?.length || s.points?.length || s.table)).toBe(true)
    expect(analyst.sections.find(s => s.id === 'audit')).toBeUndefined()
  })
})

describe('search', () => {
  it('filters sections and glossary entries as you type, and clears', async () => {
    const user = userEvent.setup()
    renderView('admin', 'tao_admin')
    const all = sectionTitles().length
    await user.type(screen.getByRole('searchbox', { name: 'Search help' }), 're-issue')
    const hits = sectionTitles()
    expect(hits.length).toBeLessThan(all)
    expect(hits).toContain('Re-issue a corrected report for a published month')
    expect(hits).not.toContain('Read the dashboard')
    expect(screen.getByText(/sections and \d+ glossary (entry|entries) match “re-issue”/)).toBeTruthy()
    await user.click(screen.getAllByRole('button', { name: 'Clear search' })[0])
    expect(sectionTitles().length).toBe(all)
  })
  it('needs every word to match and says when nothing does', async () => {
    const user = userEvent.setup()
    renderView('investor', 'investor_viewer')
    await user.type(screen.getByRole('searchbox', { name: 'Search help' }), 'watch buffer')
    expect(sectionTitles()).toContain('Read covenant status')
    await user.clear(screen.getByRole('searchbox', { name: 'Search help' }))
    await user.type(screen.getByRole('searchbox', { name: 'Search help' }), 'qqqzzz')
    expect(screen.getByRole('heading', { name: 'Nothing matches' })).toBeTruthy()
  })
  it('matches step text and table cells, not only titles', () => {
    const testing = ADMIN_HELP.sections.find(s => s.id === 'testing')!
    expect(matchesSection(testing, 'TLFC_LP-202604')).toBe(true)
    expect(matchesSection(testing, 'vcc iv')).toBe(true)
    expect(matchesSection(testing, 'nonexistent-word')).toBe(false)
  })
})

describe('links and anchors', () => {
  const shells: { shell: HelpShell; pages: Page[] }[] = [
    { shell: 'admin', pages: ADMIN_PAGES },
    { shell: 'investor', pages: PARTNER_PAGES.map(p => ({ ...p, path: '/investor' + p.path })) },
    { shell: 'manager', pages: PARTNER_PAGES.map(p => ({ ...p, path: '/manager' + p.path })) },
  ]
  for (const { shell, pages } of shells) {
    for (const r of ROLES.filter(x => x.shell === shell)) {
      it(`every link for ${r.id} goes to a built page or a section the role can see`, () => {
        const c = forRole(contentFor(shell), r.id)
        const ids = new Set([...c.sections.map(s => s.id), GLOSSARY_ID])
        const targets = linkTargets(c)
        if (shell === 'admin') expect(targets.length).toBeGreaterThan(10)
        for (const t of targets) {
          if (t.startsWith('#')) { expect(ids.has(t.slice(1)), `${t} for ${r.id}`).toBe(true); continue }
          const path = resolveLink(t, shell)
          const page = pages.find(p => p.path && matchPath(p.path, path))
          expect(page, `${path} is not in pages.ts`).toBeTruthy()
          expect(page!.built, `${path} is not built`).toBe(true)
          expect(!page!.roles || page!.roles.includes(r.id), `${path} is closed to ${r.id}`).toBe(true)
        }
      })
    }
  }
  it('renders page links with the portal prefix and section links as anchors', () => {
    renderView('investor', 'investor_viewer')
    const portfolio = screen.getAllByRole('link', { name: 'Portfolio Executive Summary' })
    expect(portfolio[0].getAttribute('href')).toBe('/investor/portfolio')
    const toc = screen.getByRole('heading', { name: 'On this page' }).closest('section')!
    expect(within(toc).getByRole('link', { name: 'Read covenant status' }).getAttribute('href')).toBe('/investor/help#covenants')
    expect(document.getElementById('covenants')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Link to this section: Read covenant status' }).getAttribute('href')).toBe('/investor/help#covenants')
  })
  it('keeps the section ids unique', () => {
    for (const c of [ADMIN_HELP, PARTNER_HELP]) {
      const ids = c.sections.map(s => s.id)
      expect(new Set(ids).size).toBe(ids.length)
      expect(ids).not.toContain(GLOSSARY_ID)
    }
  })
  it('parses bold labels and links', () => {
    expect(parseInline('Select **Publish** on [Uploads](/admin/uploads), see [this](#publish).')).toEqual([
      { kind: 'text', text: 'Select ' }, { kind: 'bold', text: 'Publish' }, { kind: 'text', text: ' on ' },
      { kind: 'link', text: 'Uploads', to: '/admin/uploads' }, { kind: 'text', text: ', see ' },
      { kind: 'link', text: 'this', to: '#publish' }, { kind: 'text', text: '.' },
    ])
  })
})

describe('content rules', () => {
  const text = JSON.stringify([ADMIN_HELP, PARTNER_HELP]).toLowerCase()
  it('uses none of the banned words', () => {
    for (const w of ['leverage', 'synergy', 'unlock', 'empower', 'robust', 'seamless', 'genuinely', 'honestly', 'straightforward', 'ecosystem', 'holistic', 'deep dive', 'moving forward', 'delve'])
      expect(text.includes(w), w).toBe(false)
  })
  it('invents no contact details', () => {
    expect(text).not.toMatch(/@[a-z0-9-]+\.[a-z]/)
    expect(text).not.toMatch(/\+?\d[\d ().-]{8,}\d/)
    expect(text).toContain('contact your tao relationship manager')
  })
})
