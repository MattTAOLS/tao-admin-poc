import type { Meta, StoryObj } from '@storybook/react'
import { Button, icons } from '../components'

const meta: Meta<typeof Button> = {
  title: 'Design System/Button',
  component: Button,
  tags: ['autodocs'],
  args: { children: 'Publish to partner', variant: 'primary' },
  argTypes: { variant: { control: 'inline-radio', options: ['primary', 'ghost', 'danger'] }, size: { control: 'inline-radio', options: ['md', 'sm'] } },
}
export default meta
type S = StoryObj<typeof Button>

export const Primary: S = { args: { variant: 'primary', iconAfter: <icons.IconArrowRight /> } }
export const Ghost: S = { args: { variant: 'ghost', children: 'View source PDF' } }
export const Danger: S = { args: { variant: 'danger', children: 'Reject' } }
export const Small: S = { args: { size: 'sm', variant: 'ghost', children: 'Use ours' } }
export const WithIcon: S = { args: { variant: 'ghost', icon: <icons.IconUpload />, children: 'Upload report' } }
export const Loading: S = { args: { loading: true, children: 'Publishing…' } }
export const Disabled: S = { args: { disabled: true, children: 'Publish to partner', title: '2 block findings are open' } }

/** Every variant × state. Tab through to see the focus ring. */
export const Matrix: S = {
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, max-content)', gap: 12, alignItems: 'center' }}>
      {(['primary', 'ghost', 'danger'] as const).map(v => (
        <div key={v} style={{ display: 'contents' }}>
          <Button variant={v}>{v}</Button>
          <Button variant={v} size="sm">{v} sm</Button>
          <Button variant={v} icon={<icons.IconCheck />}>with icon</Button>
          <Button variant={v} loading>loading</Button>
          <Button variant={v} disabled>disabled</Button>
        </div>
      ))}
    </div>
  ),
}
