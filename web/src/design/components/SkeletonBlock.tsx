import type { CSSProperties } from 'react'

export type SkeletonBlockProps = {
  width?: CSSProperties['width']
  height?: CSSProperties['height']
  radius?: CSSProperties['borderRadius']
  /** Render n text-like lines instead of one block; the last line is shorter. */
  lines?: number
  className?: string
  style?: CSSProperties
}

/** Loading placeholder in --lav. Static (motion.md has no shimmer). Hidden from assistive tech; mark the
 * container aria-busy and give it a visually hidden "Loading" instead. */
export function SkeletonBlock({ width = '100%', height = 14, radius, lines, className, style }: SkeletonBlockProps) {
  if (lines && lines > 1) {
    return (
      <span className={['ds-skel-stack', className].filter(Boolean).join(' ')} style={{ width, ...style }} aria-hidden="true" data-testid="skeleton">
        {Array.from({ length: lines }, (_, i) => <span key={i} className="ds-skel ds-skel--text" style={{ width: i === lines - 1 ? '62%' : '100%', borderRadius: radius }} />)}
      </span>
    )
  }
  return <span className={['ds-skel', className].filter(Boolean).join(' ')} style={{ width, height, borderRadius: radius, ...style }} aria-hidden="true" data-testid="skeleton" />
}
