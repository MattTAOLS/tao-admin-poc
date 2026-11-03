import type { StorybookConfig } from '@storybook/react-vite'

// Storybook for the Design System (web/src/design) and the shell (web/src/shell). It reuses web/vite.config.ts,
// so the @ and @contracts aliases and the fs allow-list for ../contracts and ../docs work as in the app.
const config: StorybookConfig = {
  stories: ['../src/design/**/*.stories.@(ts|tsx)', '../src/shell/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-essentials', '@storybook/addon-a11y'],
  framework: { name: '@storybook/react-vite', options: {} },
  core: { disableTelemetry: true },
  docs: { autodocs: 'tag' },
}
export default config
