import { Card, StatePanel, StatusPill, type Tone } from '@/design/components'
import { usePageHeader } from '@/shell/header'
import { ROLES } from '@/shell/roles'
import { useRole } from './hooks'
import { TextLink } from './ui'

export type Can = 'yes' | 'no' | 'limited'
export type Ability = { ability: string; limit?: string; isNew?: boolean; can: [Can, Can, Can, Can, Can, Can] }
const Y: Can = 'yes', N: Can = 'no', L: Can = 'limited'

/** D8 d. The six roles in shell/roles.ts order: tao_admin, tao_analyst, investor_admin, investor_viewer, manager_admin,
 * manager_viewer. Fixed in this release; the API enforces every row (contracts/openapi.yaml). New = waves B and C. */
export const MATRIX: { group: string; rows: Ability[] }[] = [
  { group: 'Reports', rows: [
    { ability: 'Upload a report', can: [Y, Y, N, N, N, N] },
    { ability: 'Open the approval queue and Review page', can: [Y, Y, N, N, N, N] },
    { ability: 'Comment and @mention on a report', isNew: true, can: [Y, Y, N, N, N, N] },
    { ability: 'Resolve or reopen a comment thread', isNew: true, limit: 'TAO Analyst: threads they started', can: [Y, L, N, N, N, N] },
    { ability: 'Resolve findings (use ours or report, restatement, acknowledge)', can: [Y, N, N, N, N, N] },
    { ability: 'Edit extracted values before publish', isNew: true, can: [Y, N, N, N, N, N] },
    { ability: 'Publish, reject, re-extract', can: [Y, N, N, N, N, N] },
    { ability: 'Publish a correction after publish', isNew: true, can: [Y, N, N, N, N, N] },
    { ability: 'Write a note to partners when publishing', isNew: true, can: [Y, N, N, N, N, N] },
    { ability: 'Open published reports and dashboards', limit: 'Partners: programs shared with their company', can: [Y, Y, L, L, L, L] },
  ] },
  { group: 'Programs', rows: [
    { ability: 'Open partners and the program / facility record', can: [Y, Y, N, N, N, N] },
    { ability: 'Edit program limits and deals', can: [Y, N, N, N, N, N] },
    { ability: 'Edit covenant definitions', isNew: true, can: [Y, N, N, N, N, N] },
  ] },
  { group: 'Notifications', rows: [
    { ability: 'Receive report notifications', isNew: true, limit: 'For the deals set in "Reports this user receives"; partners only while partner notifications are on', can: [Y, Y, Y, Y, Y, Y] },
    { ability: 'Choose own notification settings (in-app; email coming later)', isNew: true, can: [Y, Y, Y, Y, Y, Y] },
  ] },
  { group: 'Users, audit and settings', rows: [
    { ability: 'Manage users (add, invite, role, deactivate)', isNew: true, limit: 'Company Admin: own company’s admins and viewers only', can: [Y, N, L, N, L, N] },
    { ability: 'Set which reports a user receives', isNew: true, limit: 'Company Admin: own company, shared programs only', can: [Y, N, L, N, L, N] },
    { ability: 'View the audit log, Reports tab', can: [Y, Y, N, N, N, N] },
    { ability: 'View the audit log, Platform tab', can: [Y, N, N, N, N, N] },
    { ability: 'System settings', isNew: true, can: [Y, N, N, N, N, N] },
  ] },
]
const CAN: Record<Can, { tone: Tone; label: string }> = { yes: { tone: 'ok', label: 'Yes' }, no: { tone: 'neutral', label: 'No' }, limited: { tone: 'warn', label: 'Limited' } }

/** Roles & permissions (D8 d): a read-only matrix, TAO Admin only. */
export default function RolesPage() {
  const role = useRole()
  usePageHeader({
    title: 'Roles & permissions',
    subtitle: 'What each of the six roles can do. Fixed in this release; not editable.',
    crumbs: [{ label: 'TAO Admin' }, { label: 'User management', href: '/admin/settings/users' }, { label: 'Roles & permissions' }],
  })
  if (role !== 'tao_admin') return <StatePanel kind="no-access" message="Roles & permissions is for TAO Admin. Switch role in the sidebar to see it." />
  return (
    <div className="adm-stack">
      <Card title="Permission matrix" subtitle="Each cell is a dot plus a word. Limited rows say the limit under the ability. New marks the abilities added in phase 2." padding="flush">
        <div className="adm-scroll">
          <table className="adm-matrix">
            <caption className="ds-visually-hidden">Abilities by role</caption>
            <thead>
              <tr><th scope="col">Ability</th>{ROLES.map(r => <th key={r.id} scope="col">{r.label}</th>)}</tr>
            </thead>
            {MATRIX.map(g => (
              <tbody key={g.group}>
                <tr className="adm-matrix__group"><th scope="rowgroup" colSpan={ROLES.length + 1}>{g.group}</th></tr>
                {g.rows.map(r => (
                  <tr key={r.ability}>
                    <th scope="row">
                      {r.ability}{r.isNew && <> <span className="adm-tag">New</span></>}
                      {r.limit && <small>{r.limit}</small>}
                    </th>
                    {r.can.map((c, i) => <td key={ROLES[i].id}><StatusPill tone={CAN[c].tone} size="sm">{CAN[c].label}</StatusPill></td>)}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </Card>
      <div className="adm-note">
        Only TAO Admin resolves, publishes and rejects; partners read published reports only, for the programs shared with them.
        To change a role’s abilities, ask the Lead: it is a contract change, not a setting. Assign roles on <TextLink to="/admin/settings/users">User management</TextLink>.
      </div>
    </div>
  )
}
