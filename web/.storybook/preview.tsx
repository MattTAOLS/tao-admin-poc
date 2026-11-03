import type { Preview } from '@storybook/react'
import '@contracts/tokens.css'
import '../src/design/base.css'
import '../src/design/components/components.css'
import { ToastProvider } from '../src/design/components'

// Every story renders on the cream canvas inside a ToastProvider, as it would inside the shell.
const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
    controls: { expanded: true },
    a11y: { config: { rules: [{ id: 'region', enabled: false }] } },
    options: { storySort: { order: ['Design System', ['Foundations', '*'], 'Shell'] } },
  },
  decorators: [
    (Story, ctx) => (
      <ToastProvider>
        {ctx.parameters.bare ? <Story /> : <div style={{ background: 'var(--cream)', minHeight: '100vh', padding: 28, boxSizing: 'border-box' }}><Story /></div>}
      </ToastProvider>
    ),
  ],
}
export default preview
