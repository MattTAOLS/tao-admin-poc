import type { Meta, StoryObj } from '@storybook/react'
import { icons } from '../components'

const meta: Meta = { title: 'Design System/Foundations' }
export default meta

const COLOURS = ['cream', 'canvas-deep', 'card', 'indigo', 'indigo-2', 'purple', 'purple-700', 'lav', 'lav-2', 'text', 'muted', 'border', 'border-card',
  'ok', 'ok-bg', 'warn', 'warn-bg', 'bad', 'bad-bg', 'blue', 'blue-bg', 'dpv', 'dpv-bg']

export const Colours: StoryObj = {
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
      {COLOURS.map(c => (
        <div key={c} className="ds-card" style={{ overflow: 'hidden' }}>
          <div style={{ height: 56, background: `var(--${c})`, borderBottom: '1px solid var(--border-card)' }} />
          <div style={{ padding: '8px 10px', fontFamily: 'var(--mono)', fontSize: 11.5 }}>--{c}</div>
        </div>
      ))}
    </div>
  ),
}

export const Type: StoryObj = {
  render: () => (
    <div className="ds-card ds-card--pad" style={{ display: 'grid', gap: 14 }}>
      <h1>Heading 1 · Plus Jakarta Sans 21 px</h1>
      <h2>Heading 2 · Plus Jakarta Sans 16 px</h2>
      <p style={{ margin: 0 }}>Body 13.5 px. Labels, nav and headings use Plus Jakarta Sans.</p>
      <p style={{ margin: 0, fontFamily: 'var(--data)', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>Data 13 px Inter, tabular: 852,371,787.56 · 15,019,971.52</p>
      <p style={{ margin: 0, fontFamily: 'var(--mono)', fontSize: 12 }}>Mono: /tranche_balance/closing · R05</p>
      <div className="ds-kpi__value">852,371,787.56</div>
    </div>
  ),
}

export const Elevation: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
      {['sh-hair', 'sh-card', 'sh-panel', 'sh-frame', 'sh-primary', 'focus'].map(s => (
        <div key={s} style={{ width: 150, height: 90, borderRadius: 'var(--r-card)', background: 'var(--card)', boxShadow: `var(--${s})`, display: 'grid', placeItems: 'center', fontFamily: 'var(--mono)', fontSize: 12 }}>--{s}</div>
      ))}
    </div>
  ),
}

export const Motion: StoryObj = {
  render: () => (
    <div className="ds-card ds-card--pad" style={{ maxWidth: 640 }}>
      <p style={{ marginTop: 0 }}>Three transitions only (contracts/motion.md). Reduced motion sets all three to 0 ms.</p>
      <table className="ds-table"><thead><tr><th>Name</th><th className="ds-num">Duration</th><th>Used for</th></tr></thead>
        <tbody>
          <tr><td className="ds-key">control</td><td className="ds-num">120 ms</td><td>buttons, nav, chips, row hover</td></tr>
          <tr><td className="ds-key">panel</td><td className="ds-num">160 ms</td><td>finding cards, dialogs, expanded rows, toasts</td></tr>
          <tr><td className="ds-key">page</td><td className="ds-num">180 ms</td><td>content column on route change</td></tr>
        </tbody></table>
    </div>
  ),
}

export const Icons: StoryObj = {
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
      {Object.entries(icons).map(([name, I]) => (
        <div key={name} className="ds-card" style={{ padding: 12, display: 'flex', gap: 10, alignItems: 'center', color: 'var(--indigo)' }}>
          <I width={18} height={18} /><span style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{name.replace('Icon', '')}</span>
        </div>
      ))}
    </div>
  ),
}
