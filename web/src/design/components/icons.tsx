/** Inline SVG icons (stroke = currentColor). The only icon set in the app; add new ones here. */
import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>
const base = (p: P) => ({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, focusable: false, ...p })

export const IconChevronRight = (p: P) => <svg {...base(p)}><path d="M9 6l6 6-6 6" /></svg>
export const IconChevronDown = (p: P) => <svg {...base(p)}><path d="M6 9l6 6 6-6" /></svg>
export const IconChevronUp = (p: P) => <svg {...base(p)}><path d="M18 15l-6-6-6 6" /></svg>
export const IconSort = (p: P) => <svg {...base(p)}><path d="M8 9l4-4 4 4" /><path d="M16 15l-4 4-4-4" /></svg>
export const IconClose = (p: P) => <svg {...base(p)}><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg>
export const IconCheck = (p: P) => <svg {...base(p)}><path d="M5 12l5 5L20 6" /></svg>
export const IconArrowRight = (p: P) => <svg {...base(p)}><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></svg>
export const IconUpload = (p: P) => <svg {...base(p)}><path d="M12 16V4" /><path d="M7 9l5-5 5 5" /><path d="M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3" /></svg>
export const IconFile = (p: P) => <svg {...base(p)}><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5" /></svg>
export const IconLock = (p: P) => <svg {...base(p)}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></svg>
export const IconCompass = (p: P) => <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5z" /></svg>
export const IconAlert = (p: P) => <svg {...base(p)}><path d="M12 3l9.5 17h-19z" /><path d="M12 10v4" /><path d="M12 17.5v.01" /></svg>
export const IconInbox = (p: P) => <svg {...base(p)}><path d="M3 13l3-8h12l3 8" /><path d="M3 13v6h18v-6h-5l-1.5 2.5h-5L8 13z" /></svg>
export const IconLayers = (p: P) => <svg {...base(p)}><path d="M3 7l9-4 9 4-9 4-9-4z" /><path d="M3 12l9 4 9-4" /><path d="M3 17l9 4 9-4" /></svg>
export const IconGrid = (p: P) => <svg {...base(p)}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
export const IconChart = (p: P) => <svg {...base(p)}><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></svg>
export const IconBook = (p: P) => <svg {...base(p)}><path d="M4 4h10a4 4 0 014 4v12H8a4 4 0 01-4-4z" /><path d="M4 16a4 4 0 014-4h10" /></svg>
export const IconBuilding = (p: P) => <svg {...base(p)}><path d="M3 21V8l9-5 9 5v13" /><path d="M9 21v-6h6v6" /></svg>
export const IconBell = (p: P) => <svg {...base(p)}><path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 003.4 0" /></svg>
export const IconHelp = (p: P) => <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></svg>
export const IconUser = (p: P) => <svg {...base(p)}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0116 0" /></svg>
export const IconUsers = (p: P) => <svg {...base(p)}><circle cx="9" cy="8" r="3.5" /><path d="M2 20a7 7 0 0114 0" /><path d="M16 4.5a3.5 3.5 0 010 7" /><path d="M22 20a7 7 0 00-4-6.3" /></svg>
export const IconSettings = (p: P) => <svg {...base(p)}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></svg>
export const IconSearch = (p: P) => <svg {...base(p)}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
export const IconFolder = (p: P) => <svg {...base(p)}><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>
export const IconSparkle = (p: P) => <svg {...base(p)}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>
export const IconSwap = (p: P) => <svg {...base(p)}><path d="M16 3l4 4-4 4" /><path d="M20 7H8" /><path d="M8 21l-4-4 4-4" /><path d="M4 17h12" /></svg>
export const IconPlus = (p: P) => <svg {...base(p)}><path d="M12 5v14" /><path d="M5 12h14" /></svg>
export const IconRefresh = (p: P) => <svg {...base(p)}><path d="M21 12a9 9 0 01-15.5 6.2L3 16" /><path d="M3 12A9 9 0 0118.5 5.8L21 8" /><path d="M21 3v5h-5" /><path d="M3 21v-5h5" /></svg>
export const IconZoom = (p: P) => <svg {...base(p)}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /><path d="M11 8v6" /><path d="M8 11h6" /></svg>
export const IconBriefcase = (p: P) => <svg {...base(p)}><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2" /><path d="M3 13h18" /></svg>
export const IconNews = (p: P) => <svg {...base(p)}><path d="M4 5h13v14H6a2 2 0 01-2-2z" /><path d="M17 9h3v8a2 2 0 01-2 2" /><path d="M8 9h5" /><path d="M8 13h5" /></svg>
export const IconShield = (p: P) => <svg {...base(p)}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M12 8v4" /><path d="M12 15.5v.01" /></svg>
export const IconClock = (p: P) => <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
