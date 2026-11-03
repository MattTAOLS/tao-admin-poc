/** Design System public API. UI agents import from '@/design/components' only.
 * Importing this module also loads components.css (tokens come from contracts/tokens.css via main.tsx). */
import './components.css'

export { Button, type ButtonProps, type ButtonVariant } from './Button'
export {
  StatusPill, UploadStatusPill, SeverityPill, FindingStatusPill, CovenantPill,
  UPLOAD_STATUS, UPLOAD_TERMINAL, SEVERITY, FINDING_STATUS, COVENANT_STATUS,
  type StatusPillProps, type Tone, type UploadStatus, type Severity, type FindingStatus, type CovenantStatus,
} from './StatusPill'
export { Card, type CardProps } from './Card'
export { KpiTile, KpiRow, type KpiTileProps } from './KpiTile'
export { DataTable, type DataTableProps, type Column } from './DataTable'
export { FindingCard, type FindingCardProps, type FindingView } from './FindingCard'
export { Field, Input, Select, Textarea, type FieldProps, type InputProps, type SelectProps, type SelectOption } from './Field'
export { FileDrop, fileMatchesAccept, type FileDropProps } from './FileDrop'
export { ToastProvider, useToast, TOAST_DURATION, TOAST_MAX, type ToastInput, type ToastTone } from './Toast'
export { Dialog, type DialogProps } from './Dialog'
export { Breadcrumb, type BreadcrumbProps, type Crumb, type LinkLike } from './Breadcrumb'
export { SkeletonBlock, type SkeletonBlockProps } from './SkeletonBlock'
export { PageHeader, type PageHeaderProps } from './PageHeader'
export { StatePanel, type StatePanelProps } from './StatePanel'
export {
  formatCurrency, formatPercent, formatNumber, formatSigned, formatPeriod, formatByUnit, formatDiffByUnit, type ValueUnit,
} from './format'
export * as icons from './icons'
