# Implementation Plan: CSC Workforce Intake

## Overview
Replace the paper Workforce Development Intake Form (4-page bilingual PDF) with an online form that submits directly to a Google Sheet. Eliminates manual Excel data entry, captures client signatures via in-browser canvas, and saves staff ~5–10 minutes per intake. Free-tier stack: HTML page on Cloudflare Pages + Apps Script Web App + one Google Sheet.

## Why this approach
- **Vanilla HTML** = no build step, anyone at CSC can read the source later, no framework lock-in.
- **Apps Script + Sheet** = the Sheet IS the database. No server to run, no cost, staff edit data in a UI they already know.
- **Canvas signature** = legally valid under E-SIGN Act + California UETA; free; no DocuSign subscription.

## Design Spec

### Vibe
**Civic-warm** — LA County form clarity + CSC red warmth. Authoritative but kind. Generous whitespace. Sturdy, not slick.

### Colors
- `--bg` `#FAF8F4` (warm cream, gentler than pure white)
- `--surface` `#FFFFFF` (form panels)
- `--ink` `#1A1A1A` (body text, 14:1 contrast)
- `--ink-soft` `#5A5A5A` (helper text, 7:1)
- `--border` `#D9D4CC` (input borders, dividers)
- `--csc-red` `#B91C1C` (CSC brand accent — section headers, focus ring, submit button)
- `--csc-red-soft` `#FEF2F2` (highlighted row background, success backdrops)
- `--focus` `#2563EB` (focus ring, 3px solid with 2px offset)
- `--success` `#15803D`
- `--error` `#DC2626`
- `--error-bg` `#FEF2F2`

### Typography
- Body: `system-ui, -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif`
- Headings: same stack, weight 700
- Sizes (client mode, mobile-first):
  - body 18px / 1.55
  - h1 32px / 1.2
  - h2 (section) 24px / 1.3
  - small / hint 16px / 1.4
- Staff mode reduces body to 16px to fit more per screen

### Layout
- Max content width 720px (client mode), 1100px (staff mode)
- Section cards: white background, 1px `--border`, 16px radius, 32px padding
- Inputs: 48px height min, 1.5px `--border`, 8px radius, focus → 2px `--csc-red`
- Checkboxes/radios: 22x22px, custom-styled, 12px gap from label
- Buttons: 52px height primary, 16px horizontal padding, 8px radius, weight 600
- Form sections separated by 24px gap

### Components
- **Language toggle**: top right, pill style, 中文 / English, current language inverted
- **Mode toggle**: small text link in footer, "Switch to staff mode"
- **Section header**: serif-feeling sans (system semibold), CSC red bottom border 2px, English on top, Chinese below in `--ink-soft`
- **Progress bar** (client mode wizard): 6px tall, `--csc-red` fill, top of viewport, sticky
- **Signature pad**: 480x180px cream-bg canvas, "Clear" + "Done" buttons, dotted baseline guide
- **Success screen**: centered card, large checkmark in `--success`, ref number in monospace, "what's next" bullet list

### Responsive breakpoints
- 375px (phone) — single column, full-width inputs, wizard mandatory
- 768px (tablet, default) — single column 720px max
- 1024px+ (desktop staff mode) — two-column dense layout

### Anti-AI floor
- No gradients, no shadow-heavy cards, no emoji icons in UI chrome.
- One precision element: the reference number badge on success screen, monospace, bordered, sharp-cornered against the rounded card.
- One asymmetric break: section headers left-aligned with red rule extending past content edge.

## Steps

### Phase 1 — Frontend scaffolding
1. Create `index.html` with semantic structure: `<header>` (CSC logo + title + lang toggle), `<main>` (form sections), `<footer>` (mode toggle, contact email, version). All form sections in correct order matching the PDF: Intake Meta → Identification → Demographics → Education → Requested Services → Additional Support → Emergency Contact → Employment History (3 entries) → Certification + Signature.
2. Create `styles.css` implementing the Design Spec above (CSS custom properties for theming, mobile-first media queries, print styles).
3. Build all form fields from the PDF with `data-en` / `data-zh` attributes on every label, option text, and placeholder. Match field types: text, tel, email, date, number, checkbox (multi), radio (single), textarea.
4. Add `applyLang(lang)` function that swaps text using data attributes and updates `html[lang]`. Default to `zh` on first load; persist choice in `localStorage`.

### Phase 2 — Form behavior
5. Add wizard mode for client (`?mode=client` default): show one section at a time with "Back / Next" buttons, sticky progress bar, validate before advancing.
6. Add staff mode (`?mode=staff`): all sections visible, dense layout, tab order optimized. Mode toggle at bottom switches `?mode=` and reloads.
7. Implement draft autosave to `localStorage.workforceIntakeDraft` on every `input` event (debounced 500ms). Restore on page load. Clear on successful submit.
8. Add "Print blank form" button (staff mode footer) that opens a print dialog with print-friendly CSS — fallback when WiFi is down.

### Phase 3 — Signature + validation
9. Add HTML5 canvas signature pad in the Certification section. Pointer events (works on mouse + finger + stylus). "Clear" button to redo. Capture as `dataURL` PNG on form submit.
10. Validate required fields before submit: Last Name, First Name, DOB, Phone, signature non-empty (check canvas pixel data), Date. Show inline error messages in current language. Scroll to first error.

### Phase 4 — Apps Script backend
11. Create `apps-script/Code.gs` with one `doPost(e)` handler. Parse JSON body, dispatch on `action`:
    - `submit` → generate ref `WD-YYYY-NNNN` (read counter from a `_meta` sheet or use `Sheet.getLastRow()`), decode signature base64 → save to Drive folder → append row to Sheet → send email to `workforce@cscla.org` with ref + name + phone → return `{ok: true, ref}`.
12. Create `apps-script/README.md` with step-by-step deploy instructions: create Sheet, create Drive folder, paste `Code.gs` into script.google.com, set `SHEET_ID` and `DRIVE_FOLDER_ID` constants, deploy as Web App, copy the `/exec` URL.
13. Add IP-based rate limiting in `Code.gs`: store last-N timestamps per IP in script properties, reject if >30 in past hour.

### Phase 5 — Wire frontend to backend
14. In `script.js`, on submit: collect all form data into an object, capture signature dataURL, POST as JSON to `APPS_SCRIPT_URL`. Show loading spinner. On `{ok: true, ref}`, render success screen with ref number + "what's next" text in both languages. On error, show retry button.
15. Add a Submission History panel (staff mode only): a small read-only iframe of the Google Sheet, embedded for staff to verify their submission landed.

### Phase 6 — Polish + verify
16. Add `<meta>` tags: title, description, viewport, theme-color (`--csc-red`). Add favicon (CSC monogram in red).
17. Add QR code on the success page that links back to the form URL — staff can print and post at the front desk.
18. Run `/verify`: confirm all PDF fields are represented, language toggle works for every string, signature captures, autosave + restore works, responsive at 375/768/1024, print styles look reasonable.
19. Manual end-to-end test: fill form as a fake client, submit, confirm row lands in Sheet with signature PNG link working, email received.

### Phase 7 — Deploy
20. Push to GitHub as `csc-workforce-intake`. Run `git remote set-head origin --auto`.
21. `wrangler pages deploy .` to Cloudflare Pages. Confirm the production URL serves correctly (curl, 200 OK).
22. In Apps Script, redeploy Web App with new permissions if needed. Update `APPS_SCRIPT_URL` in `script.js` and redeploy Pages.
23. Generate a QR code linking to the production URL — give to user to print and post at CSC front desk.

## Files to Create/Modify
- `index.html` — single-page form with all sections, semantic HTML, bilingual data attributes
- `styles.css` — Civic-warm design system, mobile-first, print styles
- `script.js` — wizard, signature pad, autosave, validation, submit
- `apps-script/Code.gs` — backend handler (paste into script.google.com)
- `apps-script/README.md` — staff-friendly setup steps with screenshots if possible
- `README.md` — project overview + how to update the form text
- `_headers` — Cloudflare Pages security headers (CSP allowing Apps Script POST)
- `_redirects` — none needed (single page)

## Open Questions
- **Sheet column order**: the user can decide once we have a working prototype — Apps Script will write whatever columns you define in a `HEADERS` constant. I'll suggest a sensible default (PDF field order).
- **Signature retention**: how long do you keep signature PNGs in Drive? Suggest indefinitely unless legal advises otherwise.
- **CSC logo**: I'll use a text placeholder ("華埠服務中心 Chinatown Service Center") in v1. If you have an SVG logo, drop it in `/logo.svg` and I'll wire it in.

## Non-goals (v1)
- Resume/document upload from client
- Client-facing portal for status checks
- SMS confirmation to client phone
- Integration with case management systems (Salesforce, Apricot, etc.)
- Multi-language beyond English / Traditional Chinese (Spanish later if needed)
