# Apps Script Backend — Setup Steps

This is the Google Apps Script Web App that receives form submissions. It writes each submission to a Google Sheet, saves the signature image to a Drive folder, and emails the team.

You don't need to be a developer to set this up — follow the steps below in order. The whole thing takes about 15 minutes the first time.

> ⚠ **Privacy note** — SSN and other personal info are stored in the Sheet. **Share the Sheet only with named CSC staff accounts. Never use "anyone with the link".**

---

## What you'll create

1. A **Google Sheet** — where each row is one client submission.
2. A **Google Drive folder** — where signature PNGs are saved.
3. An **Apps Script Web App** — the small program that connects the form to the Sheet.

All three live in your CSC Google account (the one staff already use).

---

## Step 1 — Create the Google Sheet

1. Go to https://sheets.google.com and click **Blank**.
2. Rename the file to: **CSC Workforce Intake — Submissions**.
3. Right-click the tab at the bottom (named "Sheet1") and rename it to **Submissions**.
4. **Copy the Sheet ID** from the URL. It's the long string between `/d/` and `/edit`:
   ```
   https://docs.google.com/spreadsheets/d/THIS_IS_THE_ID/edit
   ```
   Paste it somewhere safe — you'll need it in Step 4.
5. Share the Sheet:
   - Click **Share** (top right)
   - Add the email of each staff member who should see submissions
   - Set their access to **Editor** (so they can clean up data)
   - **Do NOT** select "Anyone with the link"

---

## Step 2 — Create the Drive folder for signatures

1. Go to https://drive.google.com and click **+ New → Folder**.
2. Name it: **CSC Workforce Intake — Signatures**.
3. Open the folder by double-clicking it.
4. **Copy the Folder ID** from the URL — it's the part after `/folders/`:
   ```
   https://drive.google.com/drive/folders/THIS_IS_THE_FOLDER_ID
   ```
5. Share this folder with the same staff members, **Viewer** access.

---

## Step 3 — Paste in the Apps Script code

1. Go to https://script.google.com and click **+ New project**.
2. Rename the project (top left, "Untitled project") to: **CSC Workforce Intake Backend**.
3. Delete the empty `function myFunction()` placeholder in `Code.gs`.
4. Open `apps-script/Code.gs` from this repo, **select all**, and **paste** into the Apps Script editor.

---

## Step 4 — Fill in your IDs

At the top of `Code.gs` you'll see this block:

```javascript
const CONFIG = {
  SHEET_ID: "REPLACE_WITH_SHEET_ID",
  SHEET_TAB_NAME: "Submissions",
  COUNTER_TAB_NAME: "_meta",
  DRIVE_FOLDER_ID: "REPLACE_WITH_DRIVE_FOLDER_ID",
  NOTIFY_EMAIL: "workforce@cscla.org",
  ...
};
```

- Replace `REPLACE_WITH_SHEET_ID` with the Sheet ID from Step 1.
- Replace `REPLACE_WITH_DRIVE_FOLDER_ID` with the Folder ID from Step 2.
- (Optional) Change `NOTIFY_EMAIL` if you want submissions emailed somewhere else.

Click the **save** icon (or `Ctrl/Cmd + S`).

---

## Step 5 — Run the setup once

This step asks Google to grant the script permission to write to your Sheet and Drive.

1. In the Apps Script editor, choose the function **`setupSheet`** from the dropdown next to ▶ Run.
2. Click **▶ Run**.
3. A popup will ask for permissions:
   - "Review permissions" → choose your CSC account
   - You may see a "Google hasn't verified this app" warning — click **Advanced → Go to CSC Workforce Intake Backend (unsafe)**. (This is normal for in-house scripts. The "unsafe" wording is Google's default for unpublished scripts.)
   - Click **Allow**.
4. The script will write the column headers to the **Submissions** tab.

Open your Sheet to confirm — the first row should now have all the field names.

---

## Step 6 — Deploy as a Web App

This makes the form able to talk to your Apps Script.

1. Click **Deploy → New deployment** (top right).
2. Click the gear icon next to "Select type" → choose **Web app**.
3. Settings:
   - **Description**: `csc-workforce-intake v1`
   - **Execute as**: **Me** (your CSC account)
   - **Who has access**: **Anyone** (this is required so the form on Cloudflare can call it — but only your script can write to your Sheet)
4. Click **Deploy**.
5. **Copy the Web app URL** — it ends in `/exec`. Paste it somewhere safe.

---

## Step 7 — Connect the form to the backend

1. Open `script.js` from the project root.
2. Near the top, find:
   ```javascript
   const APPS_SCRIPT_URL = "";
   ```
3. Paste the `/exec` URL between the quotes:
   ```javascript
   const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfy.../exec";
   ```
4. Save and re-deploy the form to Cloudflare Pages.

---

## Step 8 — Test end-to-end

1. Open the production form URL in a private/incognito window.
2. Fill in: First Name, Last Name, DOB, Phone, a quick signature, and Date.
3. Click **Submit**.
4. You should see a green confirmation screen with a reference number like `WD-2026-0001`.
5. Open the Sheet — the row should be there.
6. Open the Drive folder — the signature PNG should be there.
7. Check the staff email inbox — there should be a notification email.

If any of those four don't happen, check the Apps Script **Executions** log (`View → Executions`) for an error.

---

## Updating the script later

If you change `Code.gs`:
1. Save the file in Apps Script.
2. Click **Deploy → Manage deployments**.
3. Click the ✏ pencil next to the current deployment.
4. Under **Version**, choose **New version**.
5. Click **Deploy**.

You do **not** need to update `APPS_SCRIPT_URL` in `script.js` — the URL stays the same across deployments of the same Web App.

---

## Common issues

| Problem | Likely cause |
|---|---|
| Form says "Could not submit" | `APPS_SCRIPT_URL` is wrong or empty, or Web App was deployed with "Only me" access. Redeploy with "Anyone" access. |
| Row appears but signature column is blank | The Drive folder ID is wrong, or the signature canvas was empty when submitted. |
| "Service Spreadsheets timed out" in Apps Script logs | Sheet has gotten very large. Archive old rows to a separate Sheet. |
| Email not arriving | Apps Script quotas: free accounts can send ~100 emails/day. Check `View → Executions`. |
| Reference numbers reset | The `_meta` tab was deleted or edited. Recreate manually (`year`, `last_seq` columns). |

---

## Yearly maintenance

At the start of each new year, **no action needed**. The reference number generator auto-detects the year and resets the sequence (e.g. `WD-2026-0142` → `WD-2027-0001`).

Annually you should:
- Archive last year's rows to a separate tab or Sheet
- Confirm staff sharing list is still correct
- Confirm `NOTIFY_EMAIL` still goes to a monitored inbox
