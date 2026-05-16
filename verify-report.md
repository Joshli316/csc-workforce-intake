# Verify Report — CSC Workforce Intake

**Date:** 2026-05-16
**Project type:** Web app (vanilla HTML/CSS/JS, no build step)

## Summary

- Categories checked: 13 (Build Integrity skipped — no build step)
- Categories passed: 13
- Issues found: 1 (OG tags missing)
- Issues auto-fixed: 1
- Issues needing human attention: 0

## Results by Category

### 1. Plan Compliance — PASS
All 23 plan steps implemented except a minor simplification:
- Step 15 (embedded Sheet iframe in staff mode) was implemented as a staff-mode footer link (`#openSheet`) gated on a `SUBMISSIONS_SHEET_URL` constant. The iframe approach would require the Sheet to be world-readable, which contradicts the privacy guidance in CLAUDE.md ("share with named staff only — never 'anyone with link'"). The link approach respects privacy and is functionally equivalent.

All planned files present: `index.html`, `styles.css`, `script.js`, `_headers`, `apps-script/Code.gs`, `apps-script/README.md`, `README.md`.

### 2. Build Integrity — SKIP
No build step (vanilla HTML/CSS/JS per CLAUDE.md tech stack).

### 3. Code Quality — PASS
- No TODOs / FIXMEs / HACKs / XXX markers
- `console.*` calls are limited to error/warn paths in Apps Script and one bracketed `[CSC intake — preview mode]` log in `script.js:512` (deliberate developer signal when `APPS_SCRIPT_URL` is unconfigured — kept)
- No hardcoded secrets
- File sizes: `index.html` 658 lines, `styles.css` 883 lines, `script.js` 662 lines, `Code.gs` 325 lines. Exceeds the 300-line "report only" threshold; not split because CLAUDE.md prioritises "anyone at CSC can read the source later" over file granularity.

### 4. Runtime Health — PASS
Tested via Playwright headless against `python3 -m http.server 8088`:
- Page loads, no console errors, no pageerrors
- Full wizard flow (Welcome → Identification → Demographics → Education → Services → Contacts → Certification → Submit) completes cleanly
- Submit in preview mode (no `APPS_SCRIPT_URL`) returns `WD-2026-PREVIEW` and renders success screen
- Signature canvas captures pointer input and serialises to PNG dataURL

### 5. Anti-Generic Design Gate — PASS

**Part A (basics):**
| Metric | Value | Pass |
|---|---|---|
| Distinct font-size values | 12 | ✓ |
| Distinct hex colors | 18 | ✓ |
| `box-shadow` rules | 5 (all functional — focus ring + radio inner-dot + print resets, **no decorative card shadows**) | ✓ |
| `transition` rules | 6 | ✓ |
| `:hover` rules | 4 | ✓ |
| Gradients | 0 (intentional per plan.md anti-AI floor) | ✓ |
| `border-radius` variations | 8 distinct values | ✓ |

**Part B (anti-AI tells):**
- Section headers left-aligned with **red rule extending past the content edge** (one asymmetric break, per plan.md)
- Sharp-cornered monospace `WD-YYYY-NNNN` ref badge against rounded cards (one precision element, per plan.md)
- No emoji in UI chrome (inline SVG checkmark on success)
- Color palette is CSC-specific (warm cream + CSC red), not default blue/gray
- No generic centered hero — bilingual brand block on left, lang toggle on right
- Hierarchy: brand → section headers w/ red rule → fields, with consistent 24px gaps but varying card padding (welcome 36px, dense staff mode 22px)

0 of 8 anti-AI patterns present.

### 6. Visual / Responsive — PASS
Screenshots in `verify/`:
- `375px.png` — phone, client wizard, single column
- `768px.png` — tablet, client wizard, 720px max
- `1024px-staff.png` — desktop staff mode, 4-column dense layout
- `success-screen.png` — full success screen with QR + ref badge
- `english-mode.png` — English language toggle state

No horizontal overflow at any breakpoint. Long text (250 chars in `notes` textarea) does not cause overflow.

### 7. Interaction Testing — PASS
- All wizard Back/Next buttons advance/retreat correctly
- Validation blocks empty submission; error summary appears
- Signature pointer events draw correctly; Clear button resets
- Language toggle swaps every visible string (verified via SSN label: `Social Security Number (optional)` ↔ `社會安全號碼（選填）`)
- Submit triggers preview-mode success screen with QR code rendering

### 8. Bilingual QA — PASS
- `html[lang]` updates: `zh-Hant` ↔ `en` on toggle
- Default loads in `zh-Hant` (LEP audience preference per DESIGN.md)
- Language preference persists in `localStorage.workforceIntakeLang`
- Every `data-en` attribute has a matching `data-zh`; placeholders use parallel `data-en-placeholder` / `data-zh-placeholder`
- Toggle button shows CURRENT state inverted (中文 is dark when in Chinese mode, English is dark when in English mode) — matches CLAUDE.md bilingual QA spec

### 9. Content QA — PASS
- No "Lorem ipsum", "asdf", "TBD", "coming soon" placeholder text
- Year references all 2026
- Civic copy is plain-language: "You can leave any question blank except..." not "Required fields are designated..."

### 10. State & Edge Cases — PASS
- **Empty state:** Submitting blank form triggers inline field errors + summary panel scrolled into view
- **Long text:** 250-char textarea input doesn't cause horizontal overflow
- **Autosave + reload:** Verified `AutosaveTest` value persisted across page reload via `localStorage.workforceIntakeDraft`, restored after navigating back to the field
- **Clear & start new:** Confirms in current language, then clears draft and reloads

### 11. Accessibility — PASS
- All form inputs wrapped in `<label class="field">` (implicit association)
- Skip link present (`a.skip-link`)
- `aria-pressed` on language toggle buttons; `role="group"` on the toggle wrapper
- `aria-live="polite"` on `#errorSummary`
- `aria-hidden` on decorative SVG and progress bar
- Focus rings: 3px solid `--focus` (#2563EB) with 2px offset
- Touch targets: buttons 52px min, checkboxes/radios 44px min row (per design spec)
- Body text 18px in client mode (LEP audience), 16px in staff mode
- QR `<img alt="">` is intentional (caption text describes it — WCAG-compliant)

### 12. SEO & Meta — PASS (auto-fixed)
- `<title>` bilingual ✓
- `<meta name="description">` bilingual ✓
- `<meta name="theme-color">` CSC red ✓
- Favicon: inline SVG with CSC monogram on red ✓
- **AUTO-FIXED:** Added `<meta property="og:title|description|type|locale|locale:alternate">` (zh_Hant_TW primary, en_US alternate)
- Semantic HTML: `<header>`, `<main>`, `<footer>`, `<section>`, `<fieldset>`, `<legend>` — all present

### 13. Performance — PASS
- No bundle to measure (vanilla, no build)
- `script.js` 22KB uncompressed, loads with `defer`
- No image assets in repo (favicon is inline SVG)
- One external HTTPS request: `api.qrserver.com` for the post-submit QR — allow-listed in `_headers` CSP, only fires after successful submit

### 14. Deploy Readiness — PASS
- Entry point `index.html` at project root ✓
- No `.env` or `node_modules` to worry about (vanilla project)
- Not yet committed to git (build session output — user will commit before `/shipit`)
- `_headers` includes CSP, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin
- Apps Script setup is a separate flow (`apps-script/README.md`) — not blocking for static page deploy

## Issues Needing Human Attention

None. Two flagged-as-report-only items deliberately left alone:

1. **Source files over 300 lines** (`index.html` 658, `styles.css` 883, `script.js` 662). Splitting would reduce readability per CLAUDE.md's stated goal of "anyone at CSC can read the source later, no framework lock-in."

2. **Step 15 simplification:** Embedded Sheet iframe → staff-mode footer link, to avoid making the Sheet world-readable. User can drop their Sheet URL into `SUBMISSIONS_SHEET_URL` in `script.js` when they have one.

## Screenshots

- `verify/375px.png` — 375px mobile (client wizard, Chinese default)
- `verify/768px.png` — 768px tablet (client wizard)
- `verify/1024px-staff.png` — 1024px desktop (staff mode, dense)
- `verify/success-screen.png` — post-submit success with ref badge + QR
- `verify/english-mode.png` — English language toggle state
