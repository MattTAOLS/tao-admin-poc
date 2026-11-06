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
const TAO: Role[] = ['tao_admin', 'tao_analyst']

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
      id: 'sign-in',
      title: 'Sign in as a user',
      intro: 'The POC has no real sign-in. **Sign in as (POC)** stands in for it: whoever opens the app picks one of the sample users, and the app acts as that person, with their role.',
      steps: [
        { text: 'Select the user card at the bottom of the sidebar. It shows who you are signed in as and their role.' },
        { text: 'In the menu **Sign in as (POC)**, pick a user. Users are grouped by role: two TAO Admins (A. Patel, R. Okafor), two TAO Analysts (J. Moreau, S. Lindqvist), and a Company Admin and a Viewer for each of Investor and Manager.' },
        { text: 'A TAO user keeps you in TAO Admin. An Investor or Manager user opens that partner’s portal at its Portfolio Executive Summary.' },
      ],
      points: [
        { text: 'Your role and partner come with the user. Comments, mentions, notifications, your profile and audit entries are in your name.' },
        { text: 'The choice is kept in this browser until you pick someone else.' },
        { text: 'If the card shows a role with **Role only · not a user**, the app works by role alone, as it did before users existed. Everything works except [Notifications](/admin/notifications), [Profile](/admin/settings/profile) and comments, which need a user. It also falls back to this when the API does not accept the user, for example one a TAO Admin deactivated.' },
        { text: 'There is no password. Do not treat the user you picked as security. Real sign-in replaces this menu after the POC.' },
      ],
    },
    {
      id: 'your-role',
      title: 'What your role can do',
      roles: ['tao_admin', 'tao_analyst'],
      points: [
        { roles: ADMIN, text: 'You are TAO Admin. You can upload, review, resolve findings, re-extract pages, reject, approve and publish, regenerate dashboards, edit partners, programs and covenant definitions, comment on reports, manage users in User management, change System settings, and read the Audit log.' },
        { roles: ANALYST, text: 'You are TAO Analyst. You can upload reports, follow their status, open every report in the Approval queue, read findings, page images and extracted values, and read Partners, the Reports library, the portfolio pages and the Audit log’s Reports tab. You can comment on findings and values and @mention colleagues; see [Comment on a report](#comments).' },
        { roles: ANALYST, text: 'You cannot resolve findings, re-extract pages, reject, approve or publish, regenerate a dashboard, change master data, manage users, change System settings or see the Audit log’s Platform tab. Those buttons do not appear for you. Ask a TAO Admin, or sign in as one if you are testing.' },
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
      id: 'edit-values',
      title: 'Edit an extracted value',
      intro: 'If a number was read wrongly, a TAO Admin can change it while the report is in review. The PDF and the original reading are kept.',
      steps: [
        { roles: ADMIN, text: 'On the review page, find the value under **Extracted values** and select **Edit**. Check it against the page crop or open the page with the page link.' },
        { roles: ADMIN, text: 'Type the new value and a **Reason** of at least 10 characters, for example what the page shows. Select **Save and re-run rules**. The findings refresh straight away.' },
        { roles: ADMIN, text: 'The value now shows **Edited** with the original underneath. **Revert** puts the original back; it asks for a short reason.' },
        { text: 'Every edit and revert is in the Activity card and the Audit log. When the report is published, each edit is listed in the deal’s corrections as **Corrected by TAO**.' },
        { roles: ANALYST, text: 'You see the Edited marker, the original value and the reason. Only a TAO Admin can edit.' },
      ],
    },
    {
      id: 'correct-published',
      title: 'Correct a published report',
      roles: ADMIN,
      intro: 'To fix a value after a report is published, without a new PDF.',
      steps: [
        { text: 'In the [Reports library](/admin/reports), or on the published report, select **Correct a value…**. Pick the values, type the new values and a reason of at least 10 characters. A note to partners is optional.' },
        { text: 'The rules re-run on the corrected numbers. If nothing blocks, it is published at once as the next version and the deal page shows **Corrected**. Earlier versions stay viewable.' },
        { text: 'If a block finding opens, the correction waits in the [Approval queue](/admin/uploads/queue) tagged **Correction**, and partners keep seeing the current version. Resolve each block with **Acknowledge** or **Accept as restatement**, then **Approve**, or **Reject** it with a reason.' },
        { text: 'A new PDF for the same month is a different route: upload it as a corrected re-issue.' },
      ],
    },
    {
      id: 'publish',
      title: 'Approve and publish',
      roles: ADMIN,
      steps: [
        { text: 'Resolve every Block finding first. Until then **Publish to partner…** is greyed out and the footer says, for example, “1 block finding is open. Resolve it before publishing.”' },
        { text: 'Select **Publish to partner…**. The dialog lists the periods, the findings you resolved, any Review findings still open and the corrections publishing writes.' },
        { text: 'Optionally, type a **Note to partners**. Partners see it exactly as typed, labelled “Note from TAO” and signed by TAO, not by you.' },
        { text: 'Check **Who gets notified**: the partner users who will be told, and under **Not notified** everyone else with the reason, such as not subscribed to the deal, deactivated, switched off, or partner notifications off. Fix a gap in User management before publishing if you need to.' },
        { text: 'Select **Approve and publish**. The status turns to Published.' },
      ],
      points: [
        { text: 'Who is notified comes from report subscriptions: active partner users at a partner the program is shared with, who receive this deal or all deals in its program. Subscribed TAO users are told too.' },
        { text: 'Partners are notified only while partner notifications are switched on in System settings. They start off. The note is stored with the published version either way, and the Audit log’s Publish entry records the note and the recipients.' },
        { text: 'A correction after publish notifies the deal’s subscribers the same way, with your note and the changed values, old → new.' },
        { text: 'Comment threads are internal and are never sent to partners.' },
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
        { text: 'Filter covenant definitions with **Deal**. The table shows the versions in force and any scheduled for a later date. **Last change** says who changed it and when. **History** lists every earlier version with the reason.' },
        { roles: ADMIN, text: 'To change limits or who sees the program, select **Edit** on **Limits and visibility**. Tick at least one partner.' },
        { roles: ADMIN, text: 'To change a deal’s name, servicer or template id, select **Edit** on its row.' },
        { roles: ADMIN, text: 'To change a covenant, select **Edit** and choose **New version from a date** (an amendment: earlier months keep the old version) or **Correct the current version** (a mistake in the definition itself). **Add covenant** adds one the deal does not have yet. Every change needs a reason of at least 10 characters, is kept in History and the Audit log, and re-checks this deal’s reports still in review. Published months do not change.' },
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
      id: 'companies',
      title: 'Find a company',
      intro: 'A company is the lender behind one or more deals. TLFC’s three MOVE Trust deals are one company. Every figure on the company pages comes from published reports.',
      steps: [
        { text: 'Select [Companies](/admin/companies) in the sidebar, under Portfolio Executive Summary.' },
        { text: 'Each row is one company. Its covenant status is the worst across its deals. Its balance adds up each deal’s closing tranche balance in that deal’s latest published month, so **Latest month** can differ between rows.' },
        { text: 'Delinquency shows the latest ratio. A company with several deals shows the range. The arrow gives the direction since the month before; rising delinquency is the bad way.' },
        { text: 'Type in search to match company and deal names. Narrow by program, industry, covenant status or adverse media. The filters stay in the address, so you can bookmark or share a filtered list.' },
        { text: 'Select a row to open the company profile. See [Read a company profile](#company-profile).' },
      ],
      points: [
        { text: '**Follow** a company with the star. Followed companies send you adverse media and negative news alerts. You can narrow the list to the companies you follow. Following needs a signed-in user; see [Sign in as a user](#sign-in).' },
        { text: '**News this week** counts items found in the last 7 days. **Adverse media** reads Clear, To review (open items wait for a TAO Admin) or Not screened (no news run has covered the company yet).' },
        { text: 'The **Notes** column counts analyst notes. Partners never see it.' },
        { text: 'A deal not yet linked to a company shows as its own row, named after the deal.' },
      ],
    },
    {
      id: 'company-profile',
      title: 'Read a company profile',
      intro: 'One page per company: its record, its deals, what to watch, how it compares with the rest of its program, and the news. Everything computed comes from published reports, never from typed-in figures.',
      steps: [
        { text: 'The header shows the company record (industry, headquarters, website, relationship since, relationship owner) and the figures from the latest published report of each deal. **Next report due** comes from the reporting calendar in System settings.' },
        { text: '**What to watch** lists plain-language signals worked out from published data: a covenant at WATCH, a ratio moving the bad way 3 months or more running, the largest obligor above 90% of its limit, the highest losses in the loaded history, utilization above 85%, a restatement or correction, or a late report. Each one links to the chart or table behind it.' },
        { text: 'The comparison charts draw this deal against the **program median**: the other companies with a deal in the same program that reports the same ratio that month. Each other company counts once, whatever its size. A company with several such deals, like TLFC, counts at the middle of its deals. This company’s own deals are left out. Choose the mean to see it instead.' },
        { text: 'Loss comparison names only the peers that report the same loss measure. A peer far off the scale is listed but not drawn.' },
        { text: '**Covenant history** shows one cell per covenant per month. Select a cell to open that month’s covenant detail on the deal page.' },
        { text: '**Obligors** shows the largest obligors from the latest report. **Restatements** lists figures the company changed in a later report, and values TAO corrected after publishing.' },
      ],
      points: [
        { text: 'Median or mean: the median is the middle company, so one company with very high losses does not drag it. The mean adds every company and divides, so one outlier moves it. Use the median for a typical company; check the mean when you want to see the outlier’s pull.' },
        { text: 'A grey month has no number yet: no report for that month has been published for the deal, or fewer than 2 other companies report it, so there is no program line. Uploading older reports fills the months in.' },
        { text: 'Covenant cells for months with a published report show the published status. Earlier months are recomputed from the ratio history the latest report prints, with the covenant definitions in force that month and the program watch buffer. A recomputed cell says so when you point at it. It was never a published status.' },
        { text: 'A covenant with no monthly series, such as a yes or no test, shows a dash in its earlier months.' },
        { text: 'There is no industry average on the charts. The program median is the comparison.' },
      ],
    },
    {
      id: 'news-adverse',
      title: 'News and adverse media',
      intro: 'A separate news worker searches free sources, Google News and GDELT, for each company’s name and aliases. It runs once a day while the feed is on. It never changes a deal number or a covenant status.',
      steps: [
        { text: 'Open a company profile. **News** lists what the last runs found, newest first: source, time, a link out and a sentiment word, Positive, Neutral or Negative.' },
        { text: '**Adverse media** lists items whose text hit a keyword in one of five categories: litigation, regulatory, fraud, insolvency and sanctions. A new item arrives **Open**.' },
        { roles: ADMIN, text: 'Read the item at its source. Mark it **Reviewed** with a note, or **Dismiss** it with a reason, for example a different company with the same name. Each change is in the Audit log.' },
        { roles: ANALYST, text: 'You can read every item. Only a TAO Admin marks an item Reviewed or dismisses it.' },
      ],
      points: [
        { text: 'Sentiment and categories come from our own keyword screening, not from a person or a model. Expect false matches. That is why a TAO Admin reviews every adverse item.' },
        { text: '**Sanctions** is a keyword hit in the news text. It is not a check against any sanctions list.' },
        { text: 'An item is kept only when the company name or an alias appears as a whole phrase in its title or summary.' },
        { text: 'Partners see an adverse item only after a TAO Admin marks it Reviewed. Open and dismissed items stay with TAO, so a wrong name match never reaches a partner.' },
        { text: 'Followers get an **Adverse media** or **Negative news** notification. See [Read your notifications](#notifications).' },
      ],
    },
    {
      id: 'company-notes',
      title: 'Add an analyst note',
      roles: TAO,
      intro: 'Notes are internal to TAO. They never reach a partner page, export or notification.',
      steps: [
        { text: 'On a company profile, write in **Analyst notes**. You can tie the note to a report month.' },
        { text: 'Type @ and a name to mention a TAO colleague. They get a mention notification that opens the note.' },
        { text: 'Edit your own note at any time. The Audit log keeps the old text.' },
      ],
      points: [
        { text: 'The author can remove a note, and so can a TAO Admin. It disappears from the page; the Audit log records the removal.' },
        { text: 'Notes belong to a person, so they need a signed-in user. See [Sign in as a user](#sign-in).' },
      ],
    },
    {
      id: 'company-record',
      title: 'Keep the company record and contacts',
      roles: ADMIN,
      intro: 'The company record groups deals and holds what the reports do not: industry, headquarters, website, aliases, relationship owner and key contacts. TAO Admin only.',
      steps: [
        { text: 'Open the company profile and edit the record. Give a reason of at least three characters. Each change is on the Platform tab of the Audit log, with before and after.' },
        { text: 'Link deals to the company. A deal belongs to one company. A deal you take away shows as its own row, named after the deal, until you link it again.' },
        { text: 'Add aliases, such as a short form of the name. The news search uses them too.' },
        { text: '**Relationship since** starts at the earliest vintage in the deal reports. Set it to override; clear it to go back.' },
        { text: 'Add, edit or remove key contacts: name, role, email and what they receive. Removing asks for a reason and is audited.' },
      ],
      points: [
        { text: 'A new company needs a short id (lowercase words joined by hyphens), a name and at least one deal.' },
        { text: 'Partners see the record and the contacts, but not the relationship owner.' },
      ],
    },
    {
      id: 'audit',
      title: 'Check the audit log',
      intro: 'Every upload, extraction, resolution, approval, publication and regeneration is an entry on the **Reports** tab. Master data changes and exports are on the **Platform** tab.',
      steps: [
        { text: 'Select [Audit log](/admin/settings/users/audit) under Account in the sidebar. It opens on this month (Toronto time).' },
        { roles: ADMIN, text: 'Choose **Reports** or **Platform**. Each tab shows its count for this month.' },
        { roles: ANALYST, text: 'You see the **Reports** tab. The Platform tab is for TAO Admin.' },
        { text: 'Earlier months are under **History**, each with its count. Select a month to open it; **Show all** loads the rest of that month.' },
        { text: 'Type in **Search** to look through every month at once, for example a deal name or a reason. Results are grouped by month with the matches highlighted.' },
        { text: 'Narrow with **Action**, **User** and **Deal**. Select a row, or press Enter on it, to see what changed (before and after), the reason and the ids.' },
        { roles: ADMIN, text: 'Select **Audit** on any row in [Uploads](/admin/uploads), [Upload history](/admin/uploads/history) or the Dashboard’s Latest uploads to see that upload’s whole trail.' },
        { text: '**Export CSV** downloads the open month of the open tab. The export itself is recorded on the Platform tab.' },
      ],
    },
    {
      id: 'notifications',
      title: 'Read your notifications',
      intro: 'Your own notifications: someone mentioned you or replied to you, a report needs review, was published or rejected, a covenant changed, or something changed on your account.',
      steps: [
        { text: 'Select [Notifications](/admin/notifications) in the sidebar. The number next to it is how many you have not read. It refreshes as you move around and every minute.' },
        { text: 'Choose a tab: **All**, **Mentions** (mentions and replies), **Reports** (needs review, published, correction, covenant changed, rejected, adverse media, negative news, report late) or **System** (your account and platform events). Tick **Unread only** to hide the rest.' },
        { text: 'Unread rows are tinted and marked **Unread**. Select the button on a row, such as **Open review** or **Open thread**, to go where it happened. Opening a row marks it read.' },
        { text: 'Select **Mark all read** to mark everything on the tab you are on as read.' },
      ],
      points: [
        { text: 'Report notifications come only for the deals you receive, set by a TAO Admin in User management. Mentions reach you whatever you receive.' },
        { text: '**Adverse media** and **Negative news** come for the companies you follow. **Report late** comes when a deal you receive has no report 5 business days after it was due, once per deal and month.' },
        { text: 'Notifications arrive in the portal only. Email is coming later.' },
        { text: 'Turn types on or off in [Profile](/admin/settings/profile). Covenant changes and corrections are always on.' },
        { text: 'Notifications belong to a person, so they need a signed-in user. See [Sign in as a user](#sign-in).' },
        { text: 'Notifications are kept for 12 months.' },
      ],
    },
    {
      id: 'comments',
      title: 'Comment on a report',
      intro: 'Comment threads sit on a report under review, on one finding or one extracted value. They are internal to TAO: partners never see them, in the portal or in a notification.',
      steps: [
        { text: 'Open a report from the [Approval queue](/admin/uploads/queue).' },
        { text: 'Start a thread on a finding card or on an extracted value, and write your comment. **Comments** at the top of the review page lists every thread on the upload, open ones first.' },
        { text: 'Type @ and a name to mention a TAO colleague. Only active TAO users are listed. They get a Mentions notification.' },
        { text: 'Reply in the thread. Everyone already in it gets a Reply notification.' },
        { text: 'When it is settled, resolve the thread. It folds into Resolved with who and when, and can be reopened.' },
      ],
      points: [
        { text: 'TAO Admin and TAO Analyst can both comment and mention. It is how an Analyst raises a value; only a TAO Admin changes it.' },
        { roles: ADMIN, text: 'You can resolve or reopen any thread.' },
        { roles: ANALYST, text: 'You can resolve or reopen the threads you started. A TAO Admin can resolve any thread.' },
        { text: 'You can edit your own comment. It shows as edited and the old text stays in the audit log. Comments cannot be deleted.' },
        { text: 'Resolving a thread does not change the finding. The finding still needs its own decision.' },
        { text: 'Threads stay on the upload after publish. A correction keeps them, marked with the version they started on.' },
        { text: 'Every comment, edit, resolve and reopen is an entry on the Reports tab of the [Audit log](/admin/settings/users/audit).' },
        { text: 'Commenting needs a signed-in user. See [Sign in as a user](#sign-in).' },
      ],
    },
    {
      id: 'profile',
      title: 'Set up your profile',
      steps: [
        { text: 'Select [Profile](/admin/settings/profile) under Account in the sidebar.' },
        { text: '**Personal details**: change your name. Email, role and company are managed by a TAO Admin in User management.' },
        { text: '**Display**: choose your time zone, date format and number format. They change how your screens show dates and numbers, never the stored figures. Collection periods always read as a month.' },
        { text: '**Notification preferences**: turn each type on or off in the portal and select **Save preferences**. Covenant changes and corrections are always on. Email is coming later. **Reset to defaults** brings back the defaults.' },
        { text: '**My activity** lists your last entries on the Reports side of the audit log.' },
      ],
      points: [
        { text: 'The **Security** card says it plainly: there is no real sign-in in the POC.' },
        { text: 'Profile changes only affect you. They are recorded on the Platform tab of the Audit log.' },
        { text: 'Profile needs a signed-in user. In role-only mode it asks you to pick one.' },
      ],
    },
    {
      id: 'user-management',
      title: 'Manage users and the reports they receive',
      roles: ADMIN,
      intro: 'Who can use the app, with which role, and which reports each person is told about. TAO Admin only; partner Company Admins manage their own team in Team members.',
      steps: [
        { text: 'Select **User management** under Account in the sidebar (/admin/settings/users).' },
        { text: 'Select **Add user** and enter the name, email and role. A partner user also needs their partner. The POC sends no invite email.' },
        { text: 'Select **Edit** on a row to change the name, email, role or partner, or the reports the user receives: a whole program, which includes deals added later, or single deals.' },
        { text: 'To remove someone, deactivate them with a reason. They can no longer act in the app and stop getting notifications; their uploads, comments and audit entries keep their name. **Reactivate** restores the same account.' },
      ],
      points: [
        { text: 'You cannot change your own role or deactivate yourself. There is always at least one active TAO Admin, and each partner keeps at least one active Company Admin.' },
        { text: 'Report subscriptions decide who is notified. They never change what a partner can see; that stays with the program’s visibility list.' },
        { text: 'A partner user can only receive programs shared with their partner.' },
        { text: 'Every change is an entry on the Platform tab of the [Audit log](/admin/settings/users/audit), with before and after.' },
      ],
    },
    {
      id: 'system-settings',
      title: 'Change system settings',
      roles: ADMIN,
      intro: 'Settings for the whole platform. TAO Admin only.',
      steps: [
        { text: 'Select **System settings** under Account in the sidebar (/admin/settings/system).' },
        { text: 'Change a setting and give a reason of at least three characters. Each change is an entry on the Platform tab of the Audit log, with before and after.' },
      ],
      points: [
        { text: '**Partner notifications** start off. While off, partners get no notifications; TAO users still do. Switch it on when partners should be told about new reports and corrections.' },
        { text: 'The reporting calendar holds the day each deal’s report is expected.' },
        { text: 'Notification defaults per role apply to new users and to **Reset to defaults** on Profile, never to choices people already made.' },
        { text: 'Publish note templates pre-fill the note to partners for a new report and for a correction.' },
        { text: 'Validation rules, tolerances and extraction templates are shown, not edited. Data is kept indefinitely; notifications for 12 months.' },
      ],
    },
    {
      id: 'companies-settings',
      title: 'Turn on the news feed and partner access',
      roles: ADMIN,
      intro: 'Two settings under **System settings › Companies and news**. Both start off. TAO Admin only.',
      steps: [
        { text: 'Open System settings under Account in the sidebar (/admin/settings/system) and go to **Companies and news**.' },
        { text: 'Switch the **news feed** on. Pick the time it runs each day (06:00 Toronto time unless you change it) and the sources: Google News, GDELT or both.' },
        { text: 'Select **Run now** to search at once instead of waiting for the next day. The line under it shows the last runs: when, how many companies, items and adverse items found, and any source that failed.' },
        { text: 'Switch **company profiles for partners** on when partners should see Companies. Until then their portals show no Companies entry, and a direct link reads Page not found.' },
        { text: 'Give a reason of at least three characters and save. Each change is on the Platform tab of the Audit log.' },
      ],
      points: [
        { text: 'Run now cannot start while the feed is off, or while another run is queued or running.' },
        { text: 'A run can end **Partial**: some company or source failed and the rest worked. The errors name which.' },
        { text: 'With company profiles off for partners, partners also get no adverse media or negative news notifications.' },
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
        { text: 'Sign in as an Investor or Manager user (see [Sign in as a user](#sign-in)) and open the deal to check the published numbers.' },
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
        { roles: ADMIN, text: 'Roles & permissions shows a placeholder in the POC.' },
        { text: 'To see notifications and comments work, sign in as a user, not role only. For partner notifications a TAO Admin first switches on partner notifications in System settings.' },
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
    { term: 'Company', meaning: 'The lender behind one or more deals. A TAO Admin links deals to it on the company record.' },
    { term: 'Program median', meaning: 'The middle value of the other companies with a deal in the same program that reports a ratio that month. Each company counts once.' },
    { term: 'Adverse media', meaning: 'A news item whose text hit a litigation, regulatory, fraud, insolvency or sanctions keyword. A TAO Admin reviews or dismisses it.' },
    { term: 'Recomputed', meaning: 'A covenant status worked out from the printed ratio history for a month before the first published one. Never published.' },
    { term: 'Extraction', meaning: 'The system reading the numbers off the PDF. Pass 2 is a second, targeted read of the pages that did not add up.' },
    { term: 'Finding', meaning: 'A rule that did not pass, shown as a card on the review page.' },
    { term: 'Block / Review / Note', meaning: 'Severity. Block stops publishing until resolved. Review asks for a look. Note is information only.' },
    { term: 'Ours / Report', meaning: 'Our recomputation from the other figures on the report, against the figure the report prints.' },
    { term: 'Tolerance', meaning: 'The rounding allowance: $1 on balances, 0.01 percentage points on ratios, none on counts.' },
    { term: 'Restatement', meaning: 'The servicer changed a figure for an earlier month in a later report, on purpose.' },
    { term: 'Re-issue', meaning: 'A corrected report for a month already published. Replaces the earlier one once approved.' },
    { term: 'Publish', meaning: 'Approve a report so partners see it. Rebuilds the program roll-up.' },
    { term: 'Sign in as (POC)', meaning: 'The sidebar menu that stands in for real sign-in: pick a sample user and the app acts as them. No password.' },
    { term: 'Role only', meaning: 'Using the app by role without a user, as before users existed. Notifications, Profile and comments need a user.' },
    { term: 'Subscription', meaning: 'A deal or a whole program a user receives notifications about. It never changes what they can see.' },
    { term: 'Thread', meaning: 'A comment conversation on one finding or one extracted value. Internal to TAO.' },
    { term: 'Mention', meaning: 'Typing @ and a TAO colleague’s name in a comment. They get a notification.' },
    { term: 'Note to partners', meaning: 'Optional text typed when publishing. Partners see it as “Note from TAO”.' },
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
        { text: 'Once TAO switches partner notifications on, a new report or correction for a deal you receive also appears in [Notifications](/notifications).' },
      ],
    },
    {
      id: 'companies',
      title: 'Look up a company',
      intro: 'When TAO turns it on, **Companies** appears in the sidebar under Portfolio Executive Summary. Until then the portal has no company pages.',
      steps: [
        { text: 'Select [Companies](/companies). Each row is one lender behind the deals shared with you, with its worst covenant status, balance, latest month, delinquency, news this week and adverse media.' },
        { text: 'Search by company or deal name, or narrow by program, industry, status or adverse media.' },
        { text: 'Select a row to open the company profile: what to watch, how the deal compares with the program median, covenant history, obligors, restatements, news and adverse media.' },
        { text: '**Follow** a company with the star to get its adverse media and negative news in [Notifications](/notifications).' },
      ],
      points: [
        { text: 'You see only the deals in programs shared with your company. A company in two programs shows only the shared deals.' },
        { text: 'The program median is the middle of the other companies with a deal in the same program that reports the same ratio that month. Each company counts once, even one with several deals.' },
        { text: 'A grey month has no number yet: no report for it has been published, or fewer than 2 other companies report it, so there is no program line.' },
        { text: 'Covenant cells before the first published month are recomputed from the ratio history the report prints. They say so when you point at them; they were never a published status.' },
        { text: 'News comes from free sources once a day, screened by keywords. **Sanctions** is a keyword in the news text, not a check against a sanctions list.' },
        { text: 'You see an adverse media item only after TAO has reviewed it.' },
        { text: 'TAO’s internal notes about a company are never shown here.' },
        { text: 'Following needs a signed-in user. See [Sign in as a user](#sign-in).' },
      ],
    },
    {
      id: 'sign-in',
      title: 'Sign in as a user',
      intro: 'The POC has no real sign-in. **Sign in as (POC)** stands in for it: whoever opens the app picks one of the sample users, and the app acts as that person, with their role.',
      steps: [
        { text: 'Select the user card at the bottom of the sidebar. It shows who you are signed in as and their role.' },
        { text: 'In **Sign in as (POC)**, pick a user. Each portal has a Company Admin and a Viewer: M. Chen and D. Alvarez for Investor, K. Novak and L. Haddad for Manager.' },
        { text: 'An Investor user opens the Investor Portal, a Manager user the Manager Portal, and a TAO user opens TAO Admin.' },
      ],
      points: [
        { text: 'If the card shows a role with **Role only · not a user**, the portal works by role alone. Everything works except [Notifications](/notifications) and [Profile](/settings/profile), which need a user.' },
        { text: 'There is no password. Do not treat the user you picked as security. Real sign-in replaces this menu after the POC.' },
      ],
    },
    {
      id: 'notifications',
      title: 'Read your notifications',
      intro: 'The {portal} tells you when a report is published or corrected, or a covenant changes, for the deals you receive. With company pages on, it also tells you about the companies you follow.',
      steps: [
        { text: 'Select [Notifications](/notifications) in the sidebar. The number next to it is how many you have not read.' },
        { text: 'Choose **All**, **Reports** or **System**. Tick **Unread only** to hide the rest. **Adverse media** and **Negative news** for companies you follow sit under Reports.' },
        { text: 'A new report or a correction shows the **Note from TAO** exactly as TAO typed it, or **No note from TAO**. A correction lists each changed value, old → new.' },
        { text: 'Select **Open report** or **Open covenant** on a row to go there. Opening a row marks it read; **Mark all read** clears the tab.' },
      ],
      points: [
        { text: 'You are told only about the deals you receive. You can still open every report shared with your company.' },
        { roles: COMPANY_ADMIN, text: 'You set which deals your teammates receive in Team members.' },
        { roles: ['investor_viewer', 'manager_viewer'], text: 'Your Company Admin sets which deals you receive, in Team members, or TAO does.' },
        { text: 'TAO switches partner notifications on. Until then this list stays empty.' },
        { text: 'Notifications arrive in the portal only. Email is coming later.' },
      ],
    },
    {
      id: 'profile',
      title: 'Set up your profile',
      steps: [
        { text: 'Select [Profile](/settings/profile) under Account in the sidebar.' },
        { text: '**Personal details**: change your name. Email, role and company are managed by your Company Admin or TAO.' },
        { text: '**Display**: choose your time zone, date format and number format. Stored figures do not change.' },
        { text: '**Notification preferences**: turn each type on or off and select **Save preferences**. Covenant changes and corrections are always on. Email is coming later.' },
        { text: '**Report subscriptions** lists the programs and deals you receive. It is read-only.' },
      ],
      points: [
        { text: 'The **Security** card says it plainly: there is no real sign-in in the POC.' },
      ],
    },
    {
      id: 'team-members',
      title: 'Manage your team',
      roles: COMPANY_ADMIN,
      intro: 'Company Admins manage the people at their own company and the reports each one receives.',
      steps: [
        { text: 'Select **Team members** under Account in the sidebar.' },
        { text: 'Add a teammate as Company Admin or Viewer of your company. The POC sends no invite email.' },
        { text: 'Select **Edit** on a teammate to change their details, role, or the reports they receive, from the programs TAO shares with your company.' },
        { text: 'To remove someone, deactivate them with a reason. Their history stays under their name.' },
      ],
      points: [
        { text: 'You cannot remove or demote yourself, and your company keeps at least one active Company Admin.' },
        { text: 'What a teammate receives sets notifications only. Every teammate can still open every report shared with your company.' },
        { text: 'You see only your own company’s people. TAO records every change.' },
      ],
    },
    {
      id: 'testing',
      title: 'Testing the portal',
      intro: 'For people testing the POC.',
      steps: [
        { text: 'Pick a user with the user card at the bottom of the sidebar. Its menu, **Sign in as (POC)**, stands in for real sign-in; see [Sign in as a user](#sign-in).' },
        { text: 'Pick **Investor · Viewer** or **Investor · Company Admin** for the Investor Portal, **Manager · Viewer** or **Manager · Company Admin** for the Manager Portal. Both partners see both programs today.' },
        { text: 'To put new numbers in the portal, switch to **TAO Admin**, upload a sample report and publish it. The TAO Admin help page, under Testing the portal, lists the sample files and the period to enter for each.' },
        { text: 'Sample reports sit in data/samples/ (F-PIL 2.0, 202605 to 202608) and data/samples/move-trust/ (MOVE Trust, 202604 to 202607). The month in the file name is the collection period: Moneda-202608 is 2026-08, TLFC_LP-202604 is 2026-04. Upload each deal’s months oldest first.' },
        { text: 'Compare the deal page with the report. Values TAO corrected show under **Data corrections**.' },
      ],
      points: [
        { text: 'Pages not built in the POC show a placeholder: Reports, Data room and What’s new.' },
        { roles: COMPANY_ADMIN, text: 'Team members, shown to Company Admin roles, is where you manage your team; see [Manage your team](#team-members).' },
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
    { term: 'Note from TAO', meaning: 'Text TAO adds when it publishes or corrects a report, shown on the notification exactly as typed.' },
    { term: 'Subscription', meaning: 'A deal or a whole program you receive notifications about. It never changes what you can see.' },
    { term: 'Sign in as (POC)', meaning: 'The sidebar menu that stands in for real sign-in: pick a sample user. No password.' },
    { term: 'Company', meaning: 'The lender behind one or more deals in your programs.' },
    { term: 'Program median', meaning: 'The middle value of the other companies in the same program that report a ratio that month. Each company counts once.' },
    { term: 'Adverse media', meaning: 'A news item about litigation, regulation, fraud, insolvency or sanctions, shown once TAO has reviewed it.' },
  ],
}
