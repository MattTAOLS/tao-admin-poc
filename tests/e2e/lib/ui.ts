import fs from 'node:fs'
import path from 'node:path'
import { expect, type Page } from '@playwright/test'
import type { Role } from './api'
import { SHOTS } from './env'

export const ROLE_LABEL: Record<Role, string> = {
  tao_admin: 'TAO Admin', tao_analyst: 'TAO Analyst',
  investor_admin: 'Investor · Company Admin', investor_viewer: 'Investor · Viewer',
  manager_admin: 'Manager · Company Admin', manager_viewer: 'Manager · Viewer',
}
const SHELL: Record<Role, string> = {
  tao_admin: '/admin', tao_analyst: '/admin', investor_admin: '/investor', investor_viewer: '/investor',
  manager_admin: '/manager', manager_viewer: '/manager',
}

/** Opens the app and switches role through the sidebar user card (the POC role switcher). */
export async function signInAs(page: Page, role: Role) {
  await page.goto('/')
  await switchRole(page, role)
}

/** Switches role through the sidebar user card. A role only sees its own shell, so the app moves to that shell. */
export async function switchRole(page: Page, role: Role) {
  await page.getByTestId('role-switcher').click()
  await page.getByRole('menuitemradio', { name: new RegExp(`(^|[^a-z_])${role}([^a-z_]|$)`) }).click()
  await expect(page.getByTestId('role-switcher')).toContainText(ROLE_LABEL[role])
  await expect(page).toHaveURL(new RegExp(`^[^?#]*//[^/]+${SHELL[role]}(/|$)`))
}

/** Sidebar navigation by link text. */
export async function navTo(page: Page, name: string | RegExp) {
  await page.locator('aside').getByRole('link', { name }).first().click()
}

/** Page title in the top bar (usePageHeader renders the only h1). */
export const pageTitle = (page: Page) => page.getByRole('heading', { level: 1 })

/** Full-page screenshot into docs/demo/ for the walkthrough. */
export async function shot(page: Page, name: string) {
  fs.mkdirSync(SHOTS, { recursive: true })
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true, animations: 'disabled' })
}

/** Money as the app prints it to the cent (en-CA style with thousands separators). */
export const cents = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** The Audit log page filtered to one upload (TAO Admin only). */
export async function openAuditFor(page: Page, uploadId: string) {
  await page.goto(`/admin/settings/users/audit?upload_id=${uploadId}`)
  await expect(pageTitle(page)).toHaveText('Audit log')
  return page.getByRole('table', { name: 'Audit log' })
}

/** Review report page for an upload. */
export async function openReview(page: Page, uploadId: string) {
  await page.goto(`/admin/uploads/queue/${uploadId}`)
  await expect(page.getByRole('region', { name: 'Decision' })).toBeVisible()
}
