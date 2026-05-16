# Design Doc: CSC Workforce Intake

## Problem Statement
Chinatown Service Center's Workforce Development department spends 5–10 minutes per client manually re-typing a 4-page paper intake form into Excel. Errors creep in (illegible handwriting, missed fields), funder reporting takes hours because data lives across hundreds of PDFs, and clients sometimes sit waiting while staff finds blank forms or a working pen. This is a one-person department serving a Limited English Proficiency immigrant community in downtown LA.

## Target Users

### Primary: CSC Workforce staff (1–3 people)
- Bilingual (English + Mandarin / Cantonese)
- Comfortable with Google Sheets, less comfortable with new software
- Phone-and-tablet equipped at intake desk
- Need to do intake while talking with client, not staring at a screen
- Will report to funders monthly — need clean, queryable data

### Secondary: Walk-in clients
- Predominantly Chinese-speaking immigrants in Los Angeles Chinatown
- Wide age range, often older (60+); some literate in Chinese only
- Many have low digital literacy
- Some prefer to fill out forms themselves; others want staff to ask questions verbally
- A signature is required for consent / case management certification

## User Journey

### Scenario A — Client fills out on tablet in waiting area
1. Staff hands tablet to client, opens the form URL (or client scans QR code on the wall)
2. Form opens in Traditional Chinese by default; client taps "English" if preferred
3. Wizard walks client through one section at a time, big text, big buttons
4. Client signs with finger on canvas at the end
5. Submit → success screen with reference number + "what happens next"
6. Staff receives email notification, opens Sheet, sees the row populated

### Scenario B — Staff interviews client and types
1. Staff opens form on laptop in `?mode=staff`
2. Single-page dense view; staff tabs through fields while asking client questions
3. Staff fills Intake Date (auto-today), Staff Name (auto from localStorage), Referral Source
4. Staff turns laptop/tablet to client for signature at the end
5. Submit → same success screen

### Scenario C — WiFi is down
1. Staff clicks "Print blank form" → prints paper version
2. Client fills out paper as before
3. Later: staff opens the online form in staff mode and types the data in from the paper
4. Reference number generated as usual

## What this product IS
- A direct paper-form replacement: same questions, same order, same legal certification
- A single source of truth (the Google Sheet) that funders and staff can query
- A bilingual, low-friction intake tool that respects clients' time and dignity

## What this product is NOT
- A case management system (clients aren't tracked over time here)
- A document upload portal (resumes, IDs, etc. — different workflow)
- A client-facing self-service portal (no login, no edit-after-submit)
- A scheduling system

## Key Design Rationale

### Why a Google Sheet as the database
Staff already use Sheets. Zero learning curve. Zero hosting cost. Easy to export for funder reports. Easy to filter, sort, pivot. Apps Script ships with native Drive integration for the signature PNGs.

### Why no DocuSign
DocuSign is $25–45/user/month. A canvas signature is legally equivalent for this consent under E-SIGN Act + California UETA. Adding DocuSign would also force clients into an email signup flow most don't have.

### Why two modes (client / staff)
Client mode needs to be slow, large, and forgiving — a 70-year-old client tapping with one finger on a tablet. Staff mode needs to be fast and dense — keyboard tab order matters more than visual breathing room. Same form, two CSS variants, mode switched via query param.

### Why Traditional Chinese (not Simplified)
The user (CSC Workforce Specialist) confirmed Traditional Chinese is the right primary for this audience. The PDF source already uses Traditional. This matters: it signals "this is for you" to the Cantonese / Taiwanese / Hong Kong community CSC serves.

### Why autosave drafts
Older clients sometimes accidentally tap "Back" or navigate away. Losing 4 pages of data and starting over is a deal-breaker. Autosave to localStorage means a refresh resumes where they left off.

### Why generate a reference number
Clients ask "Did you get my form?" — a ref number is a tangible confirmation. Also useful for staff: "Pull up WD-2026-0142" is faster than searching by name.

### Why optional everything except 6 fields
Many clients decline to state race, immigration status, SSN, etc. The form must accept blanks for those, not block submission. Only the bare minimum needed to follow up is required: name, DOB, phone, signature, date.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| SSN sits in a Google Sheet | Sheet shared with named accounts only, no "anyone with link." Documented in setup README. |
| Apps Script Web App URL leaked → spam submissions | IP rate limit (30/hour), submission deduplication by ref number, manual review in Sheet |
| WiFi down during intake | "Print blank form" button → paper fallback → staff types in later |
| Client doesn't sign | Frontend validation blocks submit; staff mode shows a clear "Signature required" error |
| Sheet accidentally deleted | Apps Script logs every submission; restore from Sheet version history (Google keeps 30 days) |
| Form is too long / clients give up | Wizard mode with progress bar; autosave so they can resume; staff can finish for them |

## Success Metrics
- **Time saved per intake**: target 5–10 minutes (no more re-typing)
- **Zero manual data entry**: 100% of v1 submissions land directly in the Sheet
- **Adoption**: staff uses the form for ≥80% of intakes within 30 days of launch
- **Error rate**: missing-required-field errors caught at submit, not at data entry the next day
