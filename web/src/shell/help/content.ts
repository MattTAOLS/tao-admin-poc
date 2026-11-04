import type { Role } from '@/shell/roles'

/** Help & support content, as data. Rendered by HelpPage.
 *
 * Inline markup inside any text: **Label** for a UI label (bold), [text](/path) for a page link, [text](#id) for a
 * link to another section on the same help page. Partner paths are written without the portal prefix
 * (/portfolio, /help); the page adds /investor or /manager. {portal} becomes "Investor Portal" or "Manager Portal".
 *
 * Every statement here was checked against the built pages and the API role gates. Do not describe a page that
 * pages.ts does not mark `built`. */

export type HelpBlock = { text: string; roles?: Role[] }
export type HelpTable = { caption: string; head: string[]; rows: string[][] }
export type HelpSection = {
  id: string
  title: string
  intro?: string
  roles?: Role[]
  /** Numbered steps. */
  steps?: HelpBlock[]
  /** Short unnumbered notes under the steps. */
  points?: HelpBlock[]
  table?: HelpTable
}
export type GlossaryEntry = { term: string; meaning: string; roles?: Role[] }
export type HelpContent = { intro: string; sections: HelpSection[]; glossary: GlossaryEntry[] }

const ADMIN: Role[] = ['tao_admin']
const ANALYST: Role[] = ['tao_analyst']
const COMPANY_ADMIN: Role[] = ['investor_admin', 'manager_admin']

// ---------------------------------------------------------------------------------------------------------------
// Testing: shared by both pages.
// ---------------------------------------------------------------------------------------------------------------

const SAMPLE_FILES: HelpTable = {
  caption: 'Sample files and the collection period to enter',
  head: ['File', 'Deal', 'Collection period'],
  rows: [
    ['Moneda-202608 -SETTREP.pdf', 'Moneda Capital Corp. (F-PIL 2.0)', '2026-08'],
    ['Stride Capital - 202608 - SETTREP.pdf', 'Stride Capital (F-PIL 2.0)', '2026-08'],
    ['Xpedite Leasing - 202608 - SETTREP.pdf', 'Xpedite Leasing (F-PIL 2.0)', '2026-08'],
    ['Dynamic Capital 1.0-SETTREP-202604.pdf', 'Dynamic Capital (MOVE Trust)', '2026-04'],
    ['Essex - 202604 - SETTREP.pdf', 'Essex Lease Financial Corp. (MOVE Trust)', '2026-04'],
    ['Finloc-202604-SETTREP.pdf', 'Finloc 2000 Inc. (MOVE Trust)', '2026-04'],
    ['MOCLP - 202604 - Servicer Report.pdf', 'Meridian OneCap LP (MOVE Trust)', '2026-04'],
    ['TLFC_LP-202604-SETTREP.pdf', 'TLFC LP (Leases) (MOVE Trust)', '2026-04'],
    ['TLFC_Leases-202604-SETTREP.pdf', 'TLFC (Leases) (MOVE Trust)', '2026-04'],
    ['TLFC_Loans-202604-SETTREP.pdf', 'TLFC (Loans) (MOVE Trust)', '2026-04'],
    ['TPine - 202604 - SETTREP.pdf', 'TPine Leasing Capital Corporation (MOVE Trust)', '2026-04'],
    ['Vault Rated - SETTREP 202604.pdf', 'VCC IV LP (MOVE Trust)', '2026-04'],
  ],
}

// ---------------------------------------------------------------------------------------------------------------
// TAO Admin shell: /admin/help
// ---------------------------------------------------------------------------------------------------------------

export const ADMIN_HELP: HelpContent = {
  intro: 'How to take a settlement report from upload to the partner portals, step by step. Each section shows only what your role can do.',
  sections: [
    {
      id: 'switch-role',
      title: 'Switch role or partner',
      intro: 'The POC has no sign-in. The role switcher stands in for it: whoever opens the app picks a role.',
      steps: [
        { text: 'Select the user card at the bottom of the sidebar. It shows the role you are using now.' },
        { text: 'Pick a role in the menu **Sign in as (POC role switcher)**: **TAO Admin**, **TAO Analyst**, **Investor · Company Admin**, **Investor · Viewer**, **Manager · Company Admin** or **Manager · Viewer**.' },
        { text: 'A TAO role keeps you in TAO Admin. An Investor or Manager role opens that partner’s portal at its Portfolio Executive Summary.' },
      ],
      points: [
        { text: 'The partner comes with the role. Pick an Investor role to see the Investor Portal and a Manager role to see the Manager Portal.' },
        { text: 'The choice is kept in this browser until you switch again.' },
        { text: 'Real sign-in replaces this switcher after the POC. Do not treat a role choice as security.' },
      ],
    },
    {
      id: 'your-role',
      title: 'What your role can do',
      roles: ['tao_admin', 'tao_analyst'],
      points: [
        { roles: ADMIN, text: 'You are TAO Admin. You can upload, review, resolve findings, re-extract pages, reject, approve and publish, regenerate dashboards, edit partners, programs and covenant definitions, and read the Audit log.' },
        { roles: ANALYST, text: 'You are TAO Analyst. You can upload reports, follow their status, open every report in the Approval queue, read findings, page images and extracted values, and read Partners, the Reports library and the portfolio pages.' },
        { roles: ANALYST, text: 'You cannot resolve findings, re-extract pages, reject, approve or publish, regenerate a dashboard, change master data or open the Audit log. Those buttons do not appear for you. Ask a TAO Admin, or switch role if you are testing.' },
      ],
    },
    {
      id: 'dashboard',
      title: 'Read the dashboard',
      steps: [
        { text: 'Select [Dashboard](/admin) in the sidebar.' },
        { text: 'The first row counts **Programs**, **Deals** and **Flagged deals** in the published portfolio. A deal is flagged when its worst covenant is at WATCH or BREACH.' },
        { text: '**Covenant status by program** shows each program’s latest published period and how many covenant tests sit at Breach, Watch, OK and Available.' },
        { text: '**Intake queue** counts uploads that are **Received**, **Extracting** and **Needs review**, and those **Published this month**.' },
        { text: '**Latest uploads** lists the five newest. Select **Review** on a row that needs review. Select **Upload history →** for every upload.' },
        { text: 'Select **Upload report** at the top right to start an upload. See [Upload a settlement report](#upload).' },
      ],
    },
    {
      id: 'upload',
      title: 'Upload a settlement report',
      intro: 'Pick the deal and the month first, then the file. The system checks the file against what you picked.',
      steps: [
        { text: 'Open [Upload report](/admin/uploads/new). It is the top-right button on Dashboard, Uploads and Upload history.' },
        { text: 'Under **1. Deal and collection period**, choose the **Deal**. Deals are grouped by program.' },
        { text: 'Type the **Collection period** as YYYY-MM. It is the settlement month on the report cover: 2026-08 for a report settled 7 Aug 2026. For the sample files it is the month in the file name.' },
        { text: 'Under **2. Settlement report**, drop the PDF or click to choose it. The drop area stays locked until the deal and period are filled in.' },
        { text: 'Select **Upload report**.' },
        { text: 'Watch the progress line: **Received › Extracting › Needs review**. The page checks every 2 seconds. The sample reports reach Needs review in about 4 to 15 seconds.' },
        { text: 'Check the two dates the page shows back. **Collection period** is what you typed. **Reporting period** is read from the report’s page header.' },
        { text: 'When the status reads Needs review, select **Review N findings →** or **Open in approval queue →**. To send another file, select **Upload another report**.' },
      ],
      points: [
        { text: 'F-PIL 2.0 reports name the month before in every page header, so the reporting period is one month earlier: Jul 2026 for collection period Aug 2026. MOVE Trust reports name the collection month itself, so both dates match. Rule R04 checks this on the review page.' },
        { text: 'Upload each deal’s months oldest first, and publish each month before you upload the next. See [Testing the portal](#testing).' },
        { text: '“An upload for this deal and collection period is already in progress” means an earlier upload of that month is still open. Find it in [Upload history](/admin/uploads/history). A TAO Admin rejects it before the month can be uploaded again.' },
        { text: '“This deal and collection period are already published” means the month is live for partners. To replace it, see [Re-issue a corrected report](#reissue).' },
      ],
    },
    {
      id: 'extraction-failed',
      title: 'When extraction fails',
      intro: 'The status turns to **Extraction failed** when the system cannot read the report. The upload card says why, and so does the upload’s details page.',
      steps: [
        { text: 'Open the upload: **Upload details →** on the upload card, or **Details** on its row in [Uploads](/admin/uploads) or [Upload history](/admin/uploads/history).' },
        { text: 'Read the reason in the message, for example “page 1 has no text layer”. If no reason was recorded, the message gives the usual cause: a scanned or blank PDF with no text to read.' },
        { roles: ADMIN, text: 'The Audit log keeps the reason too, on the upload’s **Extract** entry.' },
        { text: 'The POC reads only PDFs that carry text; there is no scanning fallback yet. Get a text PDF from the servicer.' },
        { text: 'Upload the corrected file for the same deal and period. A failed upload does not hold the month, so the new upload goes straight in.' },
        { roles: ADMIN, text: 'Optional: close the failed upload with **Reject…** on its details page.' },
      ],
    },
    {
      id: 'status',
      title: 'Follow an upload’s status',
      intro: 'Every upload carries one status, shown as a dot and a word.',
      steps: [
        { text: '**Received**: the file is stored and waiting for the reader.' },
        { text: '**Extracting**: the system is reading the numbers and checking them against the rules.' },
        { text: '**Needs review**: extraction finished. The findings wait for a TAO Admin in the [Approval queue](/admin/uploads/queue).' },
        { text: '**Published**: a TAO Admin approved it. Partners see it now. Approve and publish happen in one click; **Approved** shows only for that moment.' },
      ],
      points: [
        { text: '**Rejected**: a TAO Admin turned it down with a reason. The month can be uploaded again.' },
        { text: '**Extraction failed**: the report could not be read. See [When extraction fails](#extraction-failed).' },
        { text: 'Re-extracting pages sends a report from Needs review back to Extracting, then back to Needs review.' },
      ],
    },
    {
      id: 'queue',
      title: 'Work the approval queue',
      steps: [
        { text: 'Select [Approval queue](/admin/uploads/queue) in the sidebar.' },
        { text: 'It lists every report that needs review, oldest first, so the one that has waited longest sits on top.' },
        { text: '**Findings** shows a count per severity, or **No findings**. A **Re-issue** tag marks a corrected re-issue.' },
        { text: 'Select a row to open the report. See [Review a report](#review).' },
      ],
      points: [
        { roles: ANALYST, text: 'You can open and read every report in the queue. The decision buttons appear for TAO Admin only.' },
      ],
    },
    {
      id: 'review',
      title: 'Review a report',
      intro: 'The review page shows what the system read, which rules failed, and the page each number came from.',
      steps: [
        { text: 'Read the **Report** card: deal and program, collection period with the settlement date, reporting period, who uploaded it, the extraction pass, a confidence score and the findings count. **Pass 2** with “re-read page 2” means the system already took a second look at that page.' },
        { text: 'Go through **Findings**. Cards are grouped **Block**, **Review** and **Note**, open ones first.' },
        { text: 'On each card read the rule ID (for example R05), the rule title and the message. **Ours** is our recomputation from the other figures on the report. **Report** is the figure the report prints. **Difference** is the gap between them; **Tolerance** is the rounding allowance.' },
        { text: 'Select the page crop on the card to open the full page at that value. Use **Previous page** and **Next page** to move through the report, then **Close**.' },
        { text: 'Check **Extracted values** for anything else. Every value has a **p. N** link that opens its page. Values carried from an earlier published month say so.' },
        { roles: ADMIN, text: 'The **Activity** card lists every audit entry for this report, newest first.' },
        { roles: ADMIN, text: 'Resolve each open finding, then publish or reject. See [Resolve a finding](#resolve), [Approve and publish](#publish) and [Reject a report](#reject).' },
      ],
      points: [
        { text: '**Block** stops publishing until a TAO Admin resolves it. **Review** asks for a look but does not stop publishing. **Note** is information only.' },
        { roles: ANALYST, text: 'Your view is read only. The footer says “Read only. Only a TAO admin can resolve findings, re-extract, reject or publish.”' },
      ],
    },
    {
      id: 'resolve',
      title: 'Resolve a finding',
      roles: ADMIN,
      steps: [
        { text: 'On an open finding card, choose one of four buttons. **Use ours**: our value is right, and publishing writes it over the report figure. **Use report**: the report figure is right, and publishing keeps it. **Accept as restatement**: the servicer revised an earlier month on purpose. **Acknowledge**: noted, no value changes.' },
        { text: 'If **Use ours** and **Use report** are greyed out, the rule names no single value to change. Use **Accept as restatement** or **Acknowledge**.' },
        { text: 'The dialog shows ours, report and the difference. For Use ours or Use report it also says what publishing writes, for example “Writes $15,020,071.52 to 5 fields”.' },
        { text: 'Type a **Reason** of at least three characters: who confirmed it, or what you checked on the page. It goes in the audit log.' },
        { text: 'Select **Save and re-run rules**. The rules run again and a message says how many block findings are still open.' },
      ],
      points: [
        { text: 'A saved choice is final. The card then shows the choice, who made it, when, and the reason.' },
        { text: 'On R05 or R07: if a part of the sum (principal, prepayments, defaults) was misread, the report’s closing balance is right. Choose **Use report**, which changes nothing.' },
        { text: 'Use ours changes what partners see. The published deal records the change under **Data corrections** on the deal page.' },
      ],
    },
    {
      id: 'reextract',
      title: 'Re-extract pages',
      roles: ADMIN,
      intro: 'Use this when a number was misread and a fresh read of the page should fix it.',
      steps: [
        { text: 'On the review page, select **Re-extract pages…** in the footer.' },
        { text: 'Pages with open findings are already ticked. Tick or untick pages as needed.' },
        { text: 'Select **Re-extract N pages**. The status goes to Extracting and the page refreshes every 2 seconds. The findings refresh when the second read finishes.' },
      ],
      points: [
        { text: 'The system already re-reads failing pages once on its own before a report reaches the queue.' },
      ],
    },
    {
      id: 'publish',
      title: 'Approve and publish',
      roles: ADMIN,
      steps: [
        { text: 'Resolve every Block finding first. Until then **Publish to partner…** is greyed out and the footer says, for example, “1 block finding is open. Resolve it before publishing.”' },
        { text: 'Select **Publish to partner…**. The dialog lists the periods, the findings you resolved, any Review findings still open and the corrections publishing writes.' },
        { text: 'Select **Approve and publish**. The status turns to Published.' },
      ],
      points: [
        { text: 'Open Review findings do not stop publishing. Publishing accepts them as shown.' },
        { text: 'Publishing sends the deal’s numbers for that month to the partner portals straight away and rebuilds the program roll-up. The Audit log records Approve and Publish.' },
        { text: 'Who sees it: every partner on the program’s visibility list. Today both Investor and Manager see both F-PIL 2.0 and MOVE Trust, and the dialog names both portals. Visibility is set on the program record; see [Partners and programs](#partners).' },
        { text: 'If the dialog refuses to publish, it says why: two resolutions write different values to one field, or the corrections make another rule fail. Select **Go to R0x** to jump to the card involved.' },
      ],
    },
    {
      id: 'reject',
      title: 'Reject a report',
      roles: ADMIN,
      steps: [
        { text: 'On the review page, select **Reject…** in the footer.' },
        { text: 'Type a **Reason** of at least three characters. It is kept in the audit log and shown on the review page.' },
        { text: 'Select **Reject report**. The status turns to Rejected and the month is free to upload again.' },
      ],
      points: [
        { text: 'The rejected upload stays in Upload history, and its review page shows the reason.' },
      ],
    },
    {
      id: 'reissue',
      title: 'Re-issue a corrected report for a published month',
      intro: 'When a servicer sends a corrected report for a month partners already see, upload it as a re-issue. It goes through review again and replaces the published report only when approved.',
      steps: [
        { text: 'Open [Upload report](/admin/uploads/new). Choose the deal and the published collection period.' },
        { text: 'The page says the month “is already published”. Tick **This is a corrected re-issue**, choose the file and select **Upload corrected re-issue**. If you skip the tick box, the **Already published** dialog asks instead: select **Upload as corrected re-issue**.' },
        { text: 'The re-issue reaches Needs review with a **Re-issue** tag. Rule R12 always blocks it, naming the report it replaces and any later published months that still carry the earlier figures. A banner on the review page says the same.' },
        { roles: ADMIN, text: 'On the R12 card select **Accept as replacement**. Say who sent the correction and why, then **Save and re-run rules**.' },
        { roles: ADMIN, text: 'Select **Publish to partner…**, then **Approve and publish**. Partners now see the re-issue. The old upload shows “Replaced by a corrected re-issue” with a link to the new one.' },
        { roles: ANALYST, text: 'A TAO Admin accepts the replacement and publishes it.' },
      ],
      points: [
        { text: 'Later published months keep the figures they had. A re-issue does not change them.' },
        { roles: ADMIN, text: 'To refuse a re-issue, select **Reject…**. The published report stays as it was.' },
      ],
    },
    {
      id: 'reports-library',
      title: 'Find published reports and regenerate a dashboard',
      steps: [
        { text: 'Select [Reports library](/admin/reports) in the sidebar. It lists every published report by program and deal, newest month first.' },
        { text: 'Narrow the list with **Program** and **Deal**.' },
        { text: '**Status** shows Published, a **Re-issue** tag, or **Replaced** for a report a re-issue superseded.' },
        { text: 'Under **Open**, **Partner view** shows the deal page for that month as partners see it. **Review record** opens the review page. **Replaces earlier report** and **Replaced by re-issue** link the two halves of a re-issue.' },
        { roles: ADMIN, text: 'To rebuild the program roll-ups, select **Regenerate dashboard…** at the top right, choose a program or **All programs**, and select **Regenerate**. The message reads, for example, “F-PIL 2.0: rebuilt from 8 published reports.”' },
      ],
      points: [
        { roles: ADMIN, text: 'Publishing already rebuilds the roll-up. Regenerate is for reprocessing by hand; nothing is re-read from the PDFs. The Audit log records each Regenerate.' },
      ],
    },
    {
      id: 'upload-history',
      title: 'Find an upload',
      steps: [
        { text: 'Select [Uploads](/admin/uploads) in the sidebar for the queue counts and the ten most recent uploads.' },
        { text: 'Select **Upload history** for every upload, newest first.' },
        { text: 'Filter by **Deal**, **Collection period** (YYYY-MM) and **Status**. The filters stay in the address, so you can send a filtered view to a colleague. **Clear filters** resets them.' },
        { text: 'Each row shows both periods, the status, Block, Review and Note counts, the file, who uploaded it and when. **Review** opens a report that needs review. **Details** opens an upload whose extraction failed.' },
        { roles: ADMIN, text: '**Audit** opens that upload’s trail in the Audit log.' },
      ],
      points: [
        { text: 'The **Re-issue** and **Replaced by re-issue** tags open the history for that deal and month, with both uploads side by side.' },
      ],
    },
    {
      id: 'partners',
      title: 'Look up partners, programs and covenant definitions',
      intro: 'This is the master data the rules compare each report against: limits, covenant thresholds and who sees each program.',
      steps: [
        { text: 'Select [Partners](/admin/partners) in the sidebar. Each row shows the partner, kind, status, the programs it sees, its deals and the total program limit.' },
        { text: 'Select a partner to open **Partner details**: its programs with currency, program limit, warehouse limit, deal count and **Visible to**.' },
        { text: 'Select a program to open its **Program / facility record**: **Limits and visibility**, **Deals** with servicer and template id, and **Covenant definitions** with legal reference, kind, threshold, watch buffer, effective date, version and source.' },
        { text: 'Filter covenant definitions with **Deal**. **Version** reads **In force**, **Superseded**, or **Scheduled** for an amendment dated later than today.' },
        { roles: ADMIN, text: 'To change limits or who sees the program, select **Edit** on **Limits and visibility**. Tick at least one partner.' },
        { roles: ADMIN, text: 'To change a deal’s name, servicer or template id, select **Edit** on its row.' },
        { roles: ADMIN, text: 'For covenants: **Edit** corrects a definition, **New version** records an amendment with a later **Effective from**, and **Add definition** adds one. Each save writes a Master data change to the Audit log.' },
      ],
      points: [
        { roles: ANALYST, text: 'These pages are read only for you: “Read only. Only TAO Admin can change master data.”' },
        { text: 'Rules R14 and R15 raise a Review finding when a report’s thresholds or limits differ from these records.' },
      ],
    },
    {
      id: 'portfolio',
      title: 'Look at the portfolio, a program and a deal',
      intro: 'These are the pages partners see, built from published reports only.',
      steps: [
        { text: 'Select [Portfolio Executive Summary](/admin/portfolio). Each program has a card with its latest collection period and **Executive summary** and **Dashboard** buttons. **Flagged deals** lists deals at WATCH or BREACH. **Go to deal** jumps to any deal.' },
        { text: '**Executive summary** opens the program summary: totals, any deal **Escalated this period**, and a card per deal with **Open deal**. The ‹ and › buttons at the top right move to the previous or next program.' },
        { text: '**Program dashboard** shows **Portfolio Metrics** and **Covenant Status & Review**: every covenant test, with **Flagged only**, **Expand all** and **Collapse all**. **Print / Save as PDF** prints the dashboard with every row expanded.' },
        { text: '**Watch threshold** on the dashboard changes the WATCH margin for this screen only. **Reset to published** puts it back. Published statuses do not change.' },
        { text: 'The deal page shows Deal Metrics, balances, aging, losses, ratios, **Covenant tests** and **Ratio history**. The ‹ and › buttons at the top right move to the previous or next deal in the program.' },
        { text: 'To see another month, use **Period** at the top of a program or deal page. It lists every published month and appears once a deal has two or more.' },
        { text: 'A program’s pages show its latest collection period and only the deals published for that month. A deal whose report for that month is not yet published drops out of the program view until it is.' },
        { text: 'In TAO Admin the deal page also shows the upload behind the month, its status, who published it, and **Open review for** that month.' },
      ],
    },
    {
      id: 'audit',
      title: 'Check the audit log',
      roles: ADMIN,
      intro: 'Every upload, extraction, resolution, approval, publication, regeneration and master data change is an entry.',
      steps: [
        { text: 'Select **Audit** on any row in [Uploads](/admin/uploads), [Upload history](/admin/uploads/history) or the Dashboard’s Latest uploads. The log opens filtered to that upload. To see everything, select [Audit log](/admin/settings/users/audit) under Account in the sidebar.' },
        { text: 'Filter by **Upload id** (paste the full id, then **Apply**) and by **Action**: Upload, Extract, Re-extract, Override, Restate, Approve, Reject, Publish, Regenerate or Master data change.' },
        { text: 'Each row shows when, the action, the role that did it, the upload, the reason and a short detail. Select the arrow at the start of a row for the full detail.' },
        { text: 'Select an upload id in the table to filter to it. **Open the upload** goes to its review page. **Clear filters** resets the view.' },
      ],
    },
    {
      id: 'testing',
      title: 'Testing the portal',
      intro: 'For people testing the POC with the sample reports.',
      steps: [
        { text: 'Get the sample PDFs. They sit in data/samples/ in the project folder: F-PIL 2.0 (Moneda, Stride, Xpedite, 202605 to 202608) at the top, MOVE Trust (nine deals, 202604 to 202607) in data/samples/move-trust/. They are not in the code repository; ask the project lead for a copy.' },
        { text: 'Enter the month in the file name as the collection period. F-PIL: Moneda-202608 is 2026-08. MOVE Trust: TLFC_LP-202604 is 2026-04. The table below maps each file to its deal.' },
        { text: 'Upload each deal’s months in order, oldest first, and publish each one before the next. A skipped month gets an R04 Block: “does not follow the prior published period”.' },
        { text: 'A clean run: Received › Extracting › Needs review in under 15 seconds; reporting period one month before the collection period (F-PIL) or the same month (MOVE Trust); no Block findings; **Approve and publish**; the deal appears in both partner portals.' },
        { text: 'Switch to **Investor · Viewer** or **Manager · Viewer** and open the deal to check the published numbers.' },
      ],
      points: [
        { text: 'Known findings that come from the reports themselves, not from bugs. Resolve each R11 with **Accept as restatement**:' },
        { text: 'Xpedite Leasing June 2026: two R11 Blocks. The report restates January 2026 total equity and debt/equity.' },
        { text: 'Xpedite Leasing July 2026: two R11 Blocks. The report restates the May 2026 rolling 3- and 12-month loss ratios.' },
        { text: 'Essex Lease Financial Corp. May 2026: two R11 Blocks. The report restates April ratios.' },
        { text: 'TLFC LP (Leases) June 2026: two R11 Blocks. The report restates the RVL ratio for April and May (0.000000% became 0.112487%).' },
        { text: 'Moneda Capital Corp. May 2026: two R18 Reviews (SLFA 9.1 (h) and (i): the report answers YES on a test our numbers put at WATCH or OK) and one R19 Note.' },
        { text: 'R19 Notes on several months, for example Moneda July 2026 “SLFA 9.1 (h) moved WATCH → OK”, and about eight across the MOVE Trust reports. Notes do not stop publishing.' },
        { text: 'Demo data only: the demo script uploads a copy of Moneda August 2026 with one digit changed on page 2. It shows one R05 Block, difference −$100.00. Resolve it with **Use ours**.' },
        { text: 'A blank or scanned PDF ends in Extraction failed. A re-issue always shows an R12 Block.' },
        { roles: ADMIN, text: 'Pages not built in the POC show a placeholder: Notifications, User management, Profile and System settings.' },
        { roles: ANALYST, text: 'Pages not built in the POC show a placeholder: Notifications and Profile.' },
      ],
      table: SAMPLE_FILES,
    },
    {
      id: 'contact',
      title: 'Get help',
      points: [
        { text: 'Contact your TAO relationship manager.' },
        { text: 'For a report problem, include the deal, the collection period and the upload’s link from the address bar.' },
      ],
    },
  ],
  glossary: [
    { term: 'SetRep', meaning: 'Settlement report. The monthly PDF a servicer sends for one deal.' },
    { term: 'Collection period', meaning: 'The settlement month on the report cover, written YYYY-MM. You enter it when you upload.' },
    { term: 'Reporting period', meaning: 'The month named in the report’s page headers. One month before the collection period for F-PIL 2.0; the same month for MOVE Trust.' },
    { term: 'Settlement date', meaning: 'The date the servicer settled the month, printed on the cover.' },
    { term: 'Program', meaning: 'A facility that holds several deals: F-PIL 2.0 or MOVE Trust.' },
    { term: 'Deal', meaning: 'One servicer’s portfolio inside a program, with its own report each month.' },
    { term: 'Partner', meaning: 'An outside party who sees published data in its own portal: Investor or Manager.' },
    { term: 'Extraction', meaning: 'The system reading the numbers off the PDF. Pass 2 is a second, targeted read of the pages that did not add up.' },
    { term: 'Finding', meaning: 'A rule that did not pass, shown as a card on the review page.' },
    { term: 'Block / Review / Note', meaning: 'Severity. Block stops publishing until resolved. Review asks for a look. Note is information only.' },
    { term: 'Ours / Report', meaning: 'Our recomputation from the other figures on the report, against the figure the report prints.' },
    { term: 'Tolerance', meaning: 'The rounding allowance: $1 on balances, 0.01 percentage points on ratios, none on counts.' },
    { term: 'Restatement', meaning: 'The servicer changed a figure for an earlier month in a later report, on purpose.' },
    { term: 'Re-issue', meaning: 'A corrected report for a month already published. Replaces the earlier one once approved.' },
    { term: 'Publish', meaning: 'Approve a report so partners see it. Rebuilds the program roll-up.' },
    { term: 'Roll-up', meaning: 'The program totals built from every deal’s published report.' },
    { term: 'Covenant', meaning: 'A test in the facility agreement, such as a loss ratio ceiling, with a legal reference like SLFA 9.1 (f).' },
    { term: 'Threshold', meaning: 'The covenant limit. A ceiling must not be exceeded; a floor must be met.' },
    { term: 'Watch buffer', meaning: 'How close to the threshold a covenant turns WATCH. 10% means within 10% of the limit.' },
    { term: 'OK / WATCH / BREACH / AVAILABLE', meaning: 'Covenant status. OK passes; WATCH is close to the limit; BREACH fails; AVAILABLE means a contractual option is open, such as a clean-up call; it is not a breach.' },
    { term: 'Template id', meaning: 'Which report layout the reader uses for a deal.' },
    { term: 'R04', meaning: 'Dates parse and periods line up: the collection period follows the reporting period and the last published month.' },
    { term: 'R05', meaning: 'Tranche balance roll-forward: the opening balance, less principal, prepayments and defaults, equals the closing balance.' },
    { term: 'R06', meaning: 'Contract count roll-forward: opening contracts, plus new, less paid out and written off, equal closing contracts.' },
    { term: 'R07', meaning: 'Aging buckets add up to the closing balance.' },
    { term: 'R08', meaning: 'Losses, recoveries and cumulative net losses tie out.' },
    { term: 'R11', meaning: 'This month’s opening equals last month’s published closing, and earlier months are unchanged.' },
    { term: 'R12', meaning: 'The month is not already published. Always raised on a re-issue.' },
    { term: 'R14', meaning: 'Covenant thresholds on the report equal the program record.' },
    { term: 'R15', meaning: 'Program and warehouse limits on the report equal the program record.' },
    { term: 'R17', meaning: 'Each covenant value recomputes from its parts.' },
    { term: 'R18', meaning: 'The covenant status the report states matches the one our numbers give.' },
    { term: 'R19', meaning: 'A covenant status changed since last month. A Note only.' },
  ],
}

// ---------------------------------------------------------------------------------------------------------------
// Partner shells: /investor/help and /manager/help
// ---------------------------------------------------------------------------------------------------------------

export const PARTNER_HELP: HelpContent = {
  intro: 'What the {portal} shows and how to read it.',
  sections: [
    {
      id: 'what-it-shows',
      title: 'What the portal shows',
      points: [
        { text: 'The {portal} shows the programs TAO has published for your organisation: today F-PIL 2.0 and MOVE Trust.' },
        { text: 'Every number comes from a servicer’s monthly settlement report. TAO reads it, checks it against its own arithmetic and the facility agreement, and approves it before you see it.' },
        { text: 'Nothing in progress appears here. You see published months only.' },
      ],
    },
    {
      id: 'portfolio',
      title: 'Find your way around the portfolio',
      steps: [
        { text: 'Select [Portfolio Executive Summary](/portfolio) in the sidebar. It is the portal’s home page.' },
        { text: 'Each program has a card with its latest collection period, the total balance, covenant counts and deals flagged.' },
        { text: '**Flagged deals** at the bottom lists every deal at WATCH or BREACH. Select **Open** on a row to go to that deal.' },
        { text: 'To jump straight to a deal, choose it in **Go to deal** at the top.' },
      ],
    },
    {
      id: 'program',
      title: 'Open a program and its dashboard',
      steps: [
        { text: 'On the program’s card, select **Executive summary**. It shows the program totals, any deal **Escalated this period**, and a card per deal.' },
        { text: 'Select **Program dashboard** at the top right, or **Dashboard** on the program’s card.' },
        { text: '**Portfolio Metrics** lists every deal with its balance, change on last period, contracts, enhancement, facility limit and utilization. Select a deal name to open it.' },
        { text: '**Covenant Status & Review** lists every covenant test. Tick **Flagged only** to see WATCH and BREACH. Select the arrow at the start of a row, or **Expand all**, to see the test in full with last period’s value.' },
        { text: 'Select **Print / Save as PDF** to print the dashboard with every row expanded.' },
        { text: 'The ‹ and › buttons at the top of the program summary move to the previous or next program.' },
      ],
    },
    {
      id: 'deal',
      title: 'Open a deal',
      steps: [
        { text: 'Select **Open deal** on a deal card, a deal name on the dashboard, or **Open** in Flagged deals.' },
        { text: 'The top line shows the deal’s worst covenant status, the collection period, the settlement date and the month it is compared with.' },
        { text: '**Deal Metrics** gives the balance, outstanding contracts, facility utilization, total enhancement and covenant counts, then balances, aging, losses and ratios in detail.' },
        { text: '**Covenant tests** lists each test with its legal reference, value, threshold, utilization, trend and status.' },
        { text: '**Ratio history** charts the latest 13 months, one series at a time.' },
        { text: 'The ‹ and › buttons at the top right move to the previous or next deal in the program.' },
      ],
      points: [
        { text: '**Data corrections** appears when TAO corrected a figure the report printed. It lists the month, the field, what it **Was**, what it is **Now** and the reason.' },
      ],
    },
    {
      id: 'covenants',
      title: 'Read covenant status',
      intro: 'Every status is a coloured dot with a word. Read the word; the colour only repeats it.',
      points: [
        { text: '**OK**: the test passes with room to spare.' },
        { text: '**WATCH**: the test passes but is close to its limit, inside the watch buffer (for example within 10% of the threshold).' },
        { text: '**BREACH**: the test fails.' },
        { text: '**AVAILABLE**: a contractual option is open, such as a clean-up call. It is not a breach.' },
        { text: 'A ceiling must not be exceeded; a floor must be met. A floor shows “min” before its threshold.' },
        { text: '**Utilization** is how much of the limit the value uses. **Trend** is Rising, Falling or Flat against last period.' },
        { text: 'On the program dashboard, **Watch threshold** changes the WATCH margin on your screen only. Statuses TAO published do not change. **Reset to published** puts it back.' },
      ],
    },
    {
      id: 'months',
      title: 'See an earlier month',
      steps: [
        { text: 'Open a program summary, program dashboard or deal.' },
        { text: 'Choose the month in **Period** at the top. It lists every published month and appears once there are two or more.' },
        { text: 'The page reloads with that month’s figures. The address keeps the month, so you can share the link.' },
      ],
      points: [
        { text: '**Balance history** on the deal page lists each published month’s roll-forward. In a covenant’s detail, **Last period** shows last month’s value and status.' },
        { text: '**Escalated this period** on the program summary names deals with a covenant that got worse since last month.' },
      ],
    },
    {
      id: 'new-numbers',
      title: 'When new numbers appear',
      points: [
        { text: 'A month appears once TAO approves and publishes that deal’s settlement report. Each deal publishes separately, so a program’s latest month can list fewer deals until every servicer’s report for that month is published.' },
        { text: 'If a servicer sends a corrected report, TAO reviews it again and the corrected figures replace the earlier ones for that month.' },
        { text: 'There are no alerts in the POC. Check the portal after month-end settlement.' },
      ],
    },
    {
      id: 'testing',
      title: 'Testing the portal',
      intro: 'For people testing the POC.',
      steps: [
        { text: 'Switch role with the user card at the bottom of the sidebar. Its menu, **Sign in as (POC role switcher)**, stands in for real sign-in.' },
        { text: 'Pick **Investor · Viewer** or **Investor · Company Admin** for the Investor Portal, **Manager · Viewer** or **Manager · Company Admin** for the Manager Portal. Both partners see both programs today.' },
        { text: 'To put new numbers in the portal, switch to **TAO Admin**, upload a sample report and publish it. The TAO Admin help page, under Testing the portal, lists the sample files and the period to enter for each.' },
        { text: 'Sample reports sit in data/samples/ (F-PIL 2.0, 202605 to 202608) and data/samples/move-trust/ (MOVE Trust, 202604 to 202607). The month in the file name is the collection period: Moneda-202608 is 2026-08, TLFC_LP-202604 is 2026-04. Upload each deal’s months oldest first.' },
        { text: 'Compare the deal page with the report. Values TAO corrected show under **Data corrections**.' },
      ],
      points: [
        { text: 'Pages not built in the POC show a placeholder: Reports, Data room, Notifications, What’s new and Profile.' },
        { roles: COMPANY_ADMIN, text: 'Team members, shown to Company Admin roles, is a placeholder too.' },
        { text: 'A partner role that opens another portal’s address is sent back to its own portal.' },
      ],
    },
    {
      id: 'contact',
      title: 'Get help',
      points: [
        { text: 'Contact your TAO relationship manager.' },
        { text: 'For a question on a number, include the program, the deal, the month and the page address.' },
      ],
    },
  ],
  glossary: [
    { term: 'Program', meaning: 'A facility that holds several deals: F-PIL 2.0 or MOVE Trust.' },
    { term: 'Deal', meaning: 'One servicer’s portfolio inside a program.' },
    { term: 'Collection period', meaning: 'The settlement month a report covers, shown as Aug 2026 or 2026-08.' },
    { term: 'Settlement date', meaning: 'The date the servicer settled that month.' },
    { term: 'Tranche balance', meaning: 'The funded balance outstanding at month end. Some programs label it NPV or contract balance.' },
    { term: 'Utilization', meaning: 'Drawn amount against the facility limit, or a covenant value against its threshold.' },
    { term: 'Enhancement', meaning: 'Credit support behind the balance, as an amount and a percentage.' },
    { term: 'CNL', meaning: 'Cumulative net losses: losses less recoveries since a vintage started.' },
    { term: 'Covenant', meaning: 'A test in the facility agreement, with a legal reference like SLFA 9.1 (f).' },
    { term: 'Threshold', meaning: 'The covenant limit. A ceiling must not be exceeded; a floor must be met.' },
    { term: 'Watch buffer', meaning: 'How close to the threshold a covenant turns WATCH.' },
    { term: 'OK / WATCH / BREACH / AVAILABLE', meaning: 'Covenant status. OK passes; WATCH is close to the limit; BREACH fails; AVAILABLE means a contractual option is open, such as a clean-up call; it is not a breach.' },
    { term: 'Data correction', meaning: 'A figure TAO published in place of the printed one, with the reason.' },
    { term: 'Published', meaning: 'Approved by TAO and visible in the portal.' },
  ],
}
