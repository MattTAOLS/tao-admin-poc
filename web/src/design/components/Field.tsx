import { cloneElement, forwardRef, isValidElement, useId, type InputHTMLAttributes, type ReactElement, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'

export type FieldProps = {
  label: ReactNode
  /** One control: <Input>, <Select>, <Textarea> or any element that accepts id / aria-* props. */
  children: ReactElement
  hint?: ReactNode
  /** Error text. Sets aria-invalid on the control and is announced via aria-describedby. */
  error?: ReactNode
  required?: boolean
  /** Override the generated id. */
  id?: string
  className?: string
}

/** Label + control + hint + error, wired for assistive tech (label for=, aria-describedby, aria-invalid). */
export function Field({ label, children, hint, error, required, id, className }: FieldProps) {
  const auto = useId()
  const controlId = id ?? (children.props as { id?: string }).id ?? `f${auto}`
  const hintId = hint ? `${controlId}-hint` : undefined
  const errId = error ? `${controlId}-err` : undefined
  const describedBy = [hintId, errId, (children.props as { 'aria-describedby'?: string })['aria-describedby']].filter(Boolean).join(' ') || undefined
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id: controlId, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined,
        required: required || (children.props as { required?: boolean }).required,
      })
    : children
  return (
    <div className={['ds-field', className].filter(Boolean).join(' ')}>
      <label className="ds-field__label" htmlFor={controlId}>
        {label}{required && <span className="ds-field__req" aria-hidden="true">*</span>}
      </label>
      {control}
      {hint && <span className="ds-field__hint" id={hintId}>{hint}</span>}
      {error && <span className="ds-field__error" id={errId} role="alert">{error}</span>}
    </div>
  )
}

export type InputProps = InputHTMLAttributes<HTMLInputElement> & { numeric?: boolean }
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ numeric, className, ...rest }, ref) {
  return <input ref={ref} className={['ds-input', numeric && 'ds-input--num', className].filter(Boolean).join(' ')} inputMode={numeric ? 'decimal' : undefined} {...rest} />
})

export type SelectOption = { value: string; label: string; disabled?: boolean }
export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  /** Flat options, or groups (e.g. deals grouped by program). Children win if both given. */
  options?: SelectOption[] | { group: string; options: SelectOption[] }[]
  placeholder?: string
}
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ options, placeholder, className, children, ...rest }, ref) {
  const body = children ?? (options && options.length > 0 && 'group' in options[0]
    ? (options as { group: string; options: SelectOption[] }[]).map(g => (
        <optgroup key={g.group} label={g.group}>{g.options.map(o => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}</optgroup>
      ))
    : (options as SelectOption[] | undefined)?.map(o => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>))
  return (
    <select ref={ref} className={['ds-select', className].filter(Boolean).join(' ')} {...rest}>
      {placeholder !== undefined && <option value="" disabled>{placeholder}</option>}
      {body}
    </select>
  )
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={['ds-textarea', className].filter(Boolean).join(' ')} {...rest} />
})
