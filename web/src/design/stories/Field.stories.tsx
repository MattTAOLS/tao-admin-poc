import type { Meta, StoryObj } from '@storybook/react'
import { Field, Input, Select, Textarea } from '../components'
import { programMove, programFpil } from './fixtures'

const meta: Meta<typeof Field> = { title: 'Design System/Field', component: Field, tags: ['autodocs'], decorators: [S => <div style={{ maxWidth: 420, display: 'grid', gap: 18 }}><S /></div>] }
export default meta
type S = StoryObj<typeof Field>

const dealOptions = [
  { group: 'F-PIL 2.0', options: programFpil.deals.map(d => ({ value: d.deal_slug, label: d.deal_name })) },
  { group: 'MOVE Trust', options: programMove.deals.map(d => ({ value: d.deal_slug, label: d.deal_name })) },
]

export const TextInput: S = { args: { label: 'Search', hint: 'Deal name or file name', children: <Input placeholder="Moneda" /> } }
export const NumericInput: S = { args: { label: 'Watch threshold (%)', hint: 'Display filter only', children: <Input numeric defaultValue="80" /> } }
export const GroupedSelect: S = { args: { label: 'Deal', required: true, children: <Select defaultValue="" placeholder="Choose a deal" options={dealOptions} /> } }
export const TextareaReason: S = { args: { label: 'Reason', required: true, hint: 'Recorded in the audit log', children: <Textarea placeholder="Why are you overriding this finding?" /> } }
export const WithError: S = { args: { label: 'Reason', required: true, error: 'A reason is required to override a finding', children: <Textarea /> } }
export const Disabled: S = { args: { label: 'Collection period', hint: 'Fixed by the upload', children: <Input disabled defaultValue="2026-08" /> } }

export const AllStates: S = {
  render: () => (<>
    <Field label="Default"><Input placeholder="Type here" /></Field>
    <Field label="With hint" hint="A short hint"><Input /></Field>
    <Field label="Required" required><Input /></Field>
    <Field label="Error" error="Something is wrong"><Input defaultValue="bad value" /></Field>
    <Field label="Disabled"><Input disabled defaultValue="read only" /></Field>
    <Field label="Select"><Select options={[{ value: 'a', label: 'Collection period 2026-08' }, { value: 'b', label: 'Collection period 2026-07' }]} /></Field>
    <Field label="Textarea"><Textarea /></Field>
  </>),
}
