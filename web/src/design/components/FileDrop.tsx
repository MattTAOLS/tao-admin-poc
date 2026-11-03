import { useId, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import { IconUpload, IconFile, IconClose } from './icons'
import { formatNumber } from './format'

export type FileDropProps = {
  /** Called with the accepted files (one unless `multiple`). Files failing `accept` or `maxBytes` go to onReject. */
  onFiles: (files: File[]) => void
  onReject?: (reason: string, files: File[]) => void
  /** Same syntax as <input accept>, e.g. ".pdf,application/pdf". */
  accept?: string
  multiple?: boolean
  maxBytes?: number
  disabled?: boolean
  /** The currently chosen file, shown as a chip with a remove button. */
  value?: File | null
  onClear?: () => void
  title?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  /** Accessible name for the drop zone. */
  label?: string
}

export function fileMatchesAccept(file: File, accept?: string) {
  if (!accept) return true
  const name = file.name.toLowerCase(), type = (file.type || '').toLowerCase()
  return accept.split(',').map(s => s.trim().toLowerCase()).filter(Boolean).some(a =>
    a.startsWith('.') ? name.endsWith(a) : a.endsWith('/*') ? type.startsWith(a.slice(0, -1)) : type === a)
}

const size = (b: number) => b >= 1048576 ? formatNumber(b / 1048576, 1) + ' MB' : formatNumber(Math.max(1, Math.round(b / 1024))) + ' KB'

/** Drag-and-drop or click / Enter / Space to choose a file. Validates type and size before calling onFiles. */
export function FileDrop({ onFiles, onReject, accept, multiple = false, maxBytes, disabled = false, value, onClear, title, hint, error, label = 'Choose a file' }: FileDropProps) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const hintId = useId(), errId = useId()

  const take = (list: FileList | null) => {
    if (!list || disabled) return
    const files = Array.from(list).slice(0, multiple ? undefined : 1)
    const badType = files.filter(f => !fileMatchesAccept(f, accept))
    const tooBig = maxBytes ? files.filter(f => f.size > maxBytes) : []
    if (badType.length) onReject?.(`Wrong file type. Expected ${accept}.`, badType)
    else if (tooBig.length) onReject?.(`File is larger than ${size(maxBytes!)}.`, tooBig)
    else if (files.length) onFiles(files)
  }
  const open = () => { if (!disabled) input.current?.click() }
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } }
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files) }

  return (
    <div>
      <div role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled || undefined} aria-label={label}
        aria-describedby={[hint ? hintId : '', error ? errId : ''].filter(Boolean).join(' ') || undefined}
        className={['ds-drop', over && 'ds-drop--over', error && 'ds-drop--error', disabled && 'ds-drop--disabled'].filter(Boolean).join(' ')}
        onClick={open} onKeyDown={onKey}
        onDragOver={e => { e.preventDefault(); if (!disabled) setOver(true) }} onDragEnter={e => { e.preventDefault(); if (!disabled) setOver(true) }}
        onDragLeave={() => setOver(false)} onDrop={onDrop} data-testid="filedrop">
        <span className="ds-drop__icon"><IconUpload /></span>
        <span className="ds-drop__title">{title ?? (over ? 'Drop to upload' : 'Drop the file here, or click to choose')}</span>
        {hint && <span className="ds-drop__hint" id={hintId}>{hint}</span>}
        <input ref={input} type="file" hidden accept={accept} multiple={multiple} disabled={disabled} tabIndex={-1}
          onChange={e => { take(e.target.files); e.target.value = '' }} data-testid="filedrop-input" />
      </div>
      {value && (
        <div className="ds-drop__file" style={{ marginTop: 10 }}>
          <IconFile width={16} height={16} />
          <span title={value.name}>{value.name}</span>
          <small>{size(value.size)}</small>
          {onClear && <button type="button" className="ds-iconbtn" aria-label={`Remove ${value.name}`} onClick={onClear} style={{ marginLeft: 'auto' }}><IconClose /></button>}
        </div>
      )}
      {error && <div className="ds-field__error" id={errId} role="alert" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  )
}
