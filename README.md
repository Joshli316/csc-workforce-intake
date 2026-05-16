# CSC Workforce Intake

Bilingual (English / Traditional Chinese) online intake form for the **Chinatown Service Center**'s Workforce Development department. Replaces the 4-page paper PDF + manual Excel entry.

- Form runs on Cloudflare Pages — vanilla HTML/CSS/JS, no build step
- Backend is a Google Apps Script Web App
- Storage: one Google Sheet (rows) + one Drive folder (signature PNGs)

## Quick start

```bash
# Preview locally
python3 -m http.server 8080
# → http://localhost:8080
```

The page works offline in "preview mode" — submissions log to the browser console instead of POSTing. Wire it to the live backend by following `apps-script/README.md`.

## Modes

- **Client mode** (default): `https://your-domain.org/` — wizard-style, one section at a time, 18px+ text, bilingual.
- **Staff mode**: `https://your-domain.org/?mode=staff` — dense single-page layout, auto-fills today's date, remembers staff name in localStorage.

Bookmark the staff URL on your laptop. Hand the client URL (or a QR code to it) to walk-in clients.

## Project layout

```
csc-workforce-intake/
├─ index.html          Form markup (all sections, bilingual data attributes)
├─ styles.css          Civic-warm design system
├─ script.js           Wizard, signature pad, autosave, validation, submit
├─ _headers            Cloudflare Pages security headers (CSP)
├─ apps-script/
│   ├─ Code.gs         Apps Script backend
│   └─ README.md       Setup steps for staff
├─ CLAUDE.md           Project conventions
├─ DESIGN.md           Problem statement, users, rationale
├─ plan.md             Implementation plan
└─ README.md           This file
```

## Editing form text

Every visible string lives twice — once in English, once in Traditional Chinese — using `data-en` / `data-zh` attributes:

```html
<span data-en="First Name" data-zh="名字">First Name</span>
```

To rename a field:
1. Open `index.html`.
2. Find the field by searching for the English label.
3. Edit both the `data-en` and `data-zh` values.
4. Redeploy.

If a string is missing from one language, the form will show the other — never blank.

## Editing the Sheet columns

Open `apps-script/Code.gs` and edit the `HEADERS` array. Then in the Apps Script editor:
1. Save the file
2. **Run → setupSheet** to overwrite the column headers
3. **Deploy → Manage deployments → New version**

Existing rows are not migrated — only new submissions follow the new header order.

## Deployment

```bash
# Cloudflare Pages — first deploy
wrangler pages deploy .

# After first GitHub push
git remote set-head origin --auto
```

Apps Script setup: see `apps-script/README.md`.

## Why this stack

- **Vanilla HTML** — staff can read the source 5 years from now without npm install
- **Google Sheet as database** — staff already use Sheets, zero learning curve, easy to filter and export for funder reports
- **Canvas signature** — legally valid under the federal E-SIGN Act + California UETA, no DocuSign subscription
- **Free** — Cloudflare Pages free tier + Apps Script free tier. Cost: $0/month.

## License

MIT (code only). The CSC logo and any client data are property of the Chinatown Service Center.
