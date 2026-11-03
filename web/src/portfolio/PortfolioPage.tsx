import { DealPage } from './DealPage'
import { usePortfolioParams } from './nav'
import { PortfolioSummary } from './PortfolioSummary'
import { ProgramDashboard } from './ProgramDashboard'
import { ProgramSummary } from './ProgramSummary'

/** /portfolio (partner shells) and /admin/portfolio. The admin shell has no nested portfolio routes yet, so its
 * program, dashboard and deal views arrive here as query parameters (see nav.ts). */
export default function PortfolioPage() {
  const { programId, dealId, view } = usePortfolioParams()
  if (programId && dealId) return <DealPage />
  if (programId && view === 'dashboard') return <ProgramDashboard />
  if (programId) return <ProgramSummary />
  return <PortfolioSummary />
}
