/**
 * CSC Workforce Intake — Apps Script Web App backend
 *
 * Endpoints:
 *   POST {action: "submit", data: {...}, signature: "data:image/png;base64,...",
 *         idempotency_key: "<uuid>", meta: {...}}
 *     → appends a row to the Sheet, saves signature PNG to Drive,
 *       emails staff, returns {ok: true, ref: "WD-2026-NNNN"}
 *
 * Setup: see apps-script/README.md
 */

// =================================================================
// CONFIG — fill these in after creating the Sheet and Drive folder
// =================================================================
const CONFIG = {
  SHEET_ID: "REPLACE_WITH_SHEET_ID",
  SHEET_TAB_NAME: "Submissions",
  COUNTER_TAB_NAME: "_meta",
  ERRORS_TAB_NAME: "_errors",
  DRIVE_FOLDER_ID: "REPLACE_WITH_DRIVE_FOLDER_ID",
  NOTIFY_EMAIL: "cscworkforcedev@gmail.com",
  ORG_NAME: "Chinatown Service Center",
  REF_PREFIX: "WD",
  RATE_LIMIT_PER_HOUR: 30,
  IDEMPOTENCY_TTL_SEC: 600,
};

// Columns written to the Sheet, in this order. Mirrors the paper Workforce
// Development Intake Form (REV 1/22/2026) field-for-field.
const HEADERS = [
  "ref",
  "submitted_at",
  // intake header
  "intake_date",
  "staff_name",
  "referral_source",
  // identification
  "last_name",
  "first_name",
  "dob",
  "address",
  "city",
  "state",
  "zip",
  "phone",
  "ssn",
  "email",
  "contact_method",
  // demographics
  "income",
  "income_period",
  "household_size",
  "gender",
  "gender_other",
  "primary_language",
  "primary_language_other",
  "race",
  "race_other",
  "ethnicity",
  "work_eligible",
  "immigrant",
  "immigrant_date",
  "residency",
  "residency_other",
  "housing",
  "housing_other",
  "commute",
  "commute_other",
  // education
  "education_level",
  "major",
  "licenses",
  "esl",
  "esl_proficiency",
  "dislocated_worker",
  // requested services
  "services",
  "services_seeking",
  "financial_situation",
  "jobs_seeking",
  "jobs_avoid",
  "emp_status_current",
  "emp_status_seeking",
  "emp_status_seeking_other",
  // additional support needs
  "programs",
  "justice_involved",
  "veteran",
  "physical_limits",
  "physical_limits_desc",
  "can_stand_4h",
  "can_lift_bend",
  "mental_health",
  "mental_health_desc",
  "accommodations",
  "accommodations_desc",
  // emergency contact
  "emergency_name",
  "emergency_relationship",
  "emergency_phone",
  "emergency_email",
  // employment history (3 entries × 9 fields)
  "job1_employer", "job1_title", "job1_start", "job1_end", "job1_status",
  "job1_duties", "job1_liked", "job1_disliked", "job1_reason",
  "job2_employer", "job2_title", "job2_start", "job2_end", "job2_status",
  "job2_duties", "job2_liked", "job2_disliked", "job2_reason",
  "job3_employer", "job3_title", "job3_start", "job3_end", "job3_status",
  "job3_duties", "job3_liked", "job3_disliked", "job3_reason",
  // certification
  "consent",
  "printed_name",
  "signature_date",
  "signature_url",
  // meta
  "lang",
  "mode",
  "user_agent",
  "client_bucket", // SHA-256 hash of UA+name+dob; bucket key only, not a real IP
];

// =================================================================
// MAIN HANDLER
// =================================================================
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action || "submit";
    if (action !== "submit") {
      return jsonResponse_({ ok: false, error: "unknown_action" });
    }

    const data = body.data || {};
    const signature = body.signature || "";
    const meta = body.meta || {};
    const idempotencyKey = body.idempotency_key || "";

    // Server-side defense-in-depth: reject obvious garbage / empty submissions.
    // Client-side validation enforces these for legitimate users; this catches
    // direct POSTs that bypass the form.
    if (!hasMinimumFields_(data)) {
      return jsonResponse_({ ok: false, error: "missing_required" });
    }

    // Idempotency: if this key was already processed within the TTL, return
    // the same ref instead of creating a duplicate row.
    if (idempotencyKey) {
      const cached = CacheService.getScriptCache().get(`idem_${idempotencyKey}`);
      if (cached) return jsonResponse_({ ok: true, ref: cached });
    }

    // Bucket key derived from stable client identity (UA + name + dob).
    // Body-hashing would have made every submission unique, defeating the cap.
    const bucket = getClientBucket_(e, data);
    if (!checkRateLimit_(bucket)) {
      return jsonResponse_({ ok: false, error: "rate_limit" });
    }

    // Allocate the ref number under a lock so two concurrent submissions can't
    // both read the same last_seq and produce duplicate refs.
    const ref = withLock_(() => nextRefNumber_());

    // Save signature PNG to Drive — best-effort. A Drive failure must not drop
    // the row, because the Sheet record is the source of truth.
    let signatureUrl = "";
    if (signature && signature.startsWith("data:image/png;base64,")) {
      try {
        signatureUrl = saveSignature_(ref, signature);
      } catch (err) {
        console.warn("Signature save failed for", ref, err);
        logError_(ref, "signature_save", err);
      }
    }

    // Append row to Sheet — also locked so two writers can't interleave.
    withLock_(() => appendRow_(ref, data, meta, signatureUrl, bucket));

    // Cache the idempotency key after success.
    if (idempotencyKey) {
      CacheService.getScriptCache()
        .put(`idem_${idempotencyKey}`, ref, CONFIG.IDEMPOTENCY_TTL_SEC);
    }

    // Notify staff by email (best-effort; don't fail submit if email fails).
    try {
      sendNotification_(ref, data);
    } catch (err) {
      console.warn("Email notification failed:", err);
      logError_(ref, "email", err);
    }

    return jsonResponse_({ ok: true, ref });
  } catch (err) {
    // Log full details to Apps Script logs + the _errors tab (Stackdriver
    // only retains 30 days; the tab persists). Return a generic message to
    // the client to avoid leaking internals.
    console.error("doPost error:", err && err.stack || err);
    try { logError_("(none)", "doPost", err); } catch (_) {}
    return jsonResponse_({ ok: false, error: "server" });
  }
}

function hasMinimumFields_(data) {
  // Match the client's REQUIRED_FIELDS minimum: name + phone.
  // (DOB and signature_date can vary in format; not safe to enforce server-side
  //  without rejecting legitimate clients who declined to provide DOB.)
  const trim = (v) => (v == null ? "" : String(v).trim());
  return !!trim(data.last_name) && !!trim(data.first_name) && !!trim(data.phone);
}

// Optional GET for quick health-check from a browser.
function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, service: "csc-workforce-intake" }))
    .setMimeType(ContentService.MimeType.JSON);
}

// =================================================================
// REFERENCE NUMBER (caller must hold a lock — see withLock_)
// =================================================================
function nextRefNumber_() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  let meta = ss.getSheetByName(CONFIG.COUNTER_TAB_NAME);
  if (!meta) {
    meta = ss.insertSheet(CONFIG.COUNTER_TAB_NAME);
    meta.getRange("A1:B1").setValues([["year", "last_seq"]]);
  }
  const year = new Date().getFullYear();
  const rows = meta.getDataRange().getValues();
  let row = -1;
  for (let i = 1; i < rows.length; i++) {
    if (Number(rows[i][0]) === year) { row = i + 1; break; }
  }
  let seq;
  if (row === -1) {
    seq = 1;
    meta.appendRow([year, seq]);
  } else {
    seq = Number(rows[row - 1][1]) + 1;
    meta.getRange(row, 2).setValue(seq);
  }
  return `${CONFIG.REF_PREFIX}-${year}-${String(seq).padStart(4, "0")}`;
}

// =================================================================
// DRIVE — save signature PNG, subfoldered by year
// =================================================================
function saveSignature_(ref, dataUrl) {
  const root = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
  const year = String(new Date().getFullYear());
  // Subfolder per year keeps Drive listings fast past ~5k files.
  const yearFolders = root.getFoldersByName(year);
  const folder = yearFolders.hasNext() ? yearFolders.next() : root.createFolder(year);

  const base64 = dataUrl.split(",")[1];
  const bytes = Utilities.base64Decode(base64);
  const blob = Utilities.newBlob(bytes, "image/png", `${ref}-signature.png`);
  const file = folder.createFile(blob);
  // Folder-level sharing (set once at install) is preferable to per-file
  // sharing — that call costs ~1s and is unnecessary if the folder is shared.
  return file.getUrl();
}

// =================================================================
// SHEET — append row (caller must hold a lock — see withLock_)
// =================================================================
function appendRow_(ref, data, meta, signatureUrl, bucket) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  let sheet = ss.getSheetByName(CONFIG.SHEET_TAB_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_TAB_NAME);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
  }

  // submitted_at is ALWAYS server-clock — a kiosk with a bad clock could
  // otherwise stamp rows with 1970 or 2099, breaking date-sort. Stored as
  // a Date object (not ISO string) so the Sheet renders it per the column's
  // number format and sorts chronologically.
  const merged = Object.assign({}, data, {
    ref,
    submitted_at: new Date(),
    signature_url: signatureUrl,
    lang: meta.lang || "",
    mode: meta.mode || "",
    user_agent: meta.user_agent || "",
    client_bucket: bucket || "",
  });

  const row = HEADERS.map((h) => sheetCellValue_(merged[h]));
  sheet.appendRow(row);
}

// Coerce a JS value into a Sheet-safe cell value.
// - arrays: comma-joined string (multi-checkbox)
// - boolean: "Yes" / "" (only `consent` is boolean today)
// - free-text starting with =/+/-/@: prefixed with ' to neutralize Sheets
//   formula injection on export — a malicious "=HYPERLINK(...)" would
//   otherwise become a live formula in the cell.
function sheetCellValue_(v) {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) v = v.join(", ");
  if (typeof v === "boolean") return v ? "Yes" : "";
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(v)) return "'" + v;
  return v;
}

// =================================================================
// EMAIL
// =================================================================
function sendNotification_(ref, data) {
  const to = CONFIG.NOTIFY_EMAIL;
  if (!to) return;
  const name = [data.first_name, data.last_name].filter(Boolean).join(" ") || "(no name)";
  const phone = data.phone || "(no phone)";
  const subject = `New intake: ${ref} — ${name}`;
  const body = [
    `A new workforce intake submission has arrived.`,
    ``,
    `Reference: ${ref}`,
    `Name: ${name}`,
    `Phone: ${phone}`,
    `Email: ${data.email || "(none)"}`,
    ``,
    `Open the Sheet to see the full record.`,
    `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/edit`,
  ].join("\n");
  MailApp.sendEmail({ to, subject, body });
}

// =================================================================
// RATE LIMIT — rolling 1-hour window per client bucket
// =================================================================
function checkRateLimit_(bucket) {
  if (!bucket) return true;
  const props = PropertiesService.getScriptProperties();
  const key = `rl_${bucket}`;
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const raw = props.getProperty(key);
  let stamps = [];
  if (raw) {
    try { stamps = JSON.parse(raw); } catch (_) { stamps = []; }
  }
  stamps = stamps.filter((t) => t > hourAgo);
  if (stamps.length >= CONFIG.RATE_LIMIT_PER_HOUR) return false;
  stamps.push(now);
  props.setProperty(key, JSON.stringify(stamps));
  return true;
}

// Apps Script can't see the real client IP. The previous implementation
// hashed the full request body, giving every submission a unique bucket and
// rendering the rate limit useless. We now hash (UA + name + dob), which is
// stable for the same client across submissions while still distinguishing
// different clients. SHA-256 is used over MD5 for hygiene; the digest is not
// a security primitive here, just a bucket key.
function getClientBucket_(e, data) {
  const ua = (e && e.postData && (e.postData.contents || "").length || 0) + ":" +
             ((e && e.parameter && (e.parameter.userAgent || "")) || "");
  const ident = [
    ua,
    String(data.last_name || "").trim().toLowerCase(),
    String(data.first_name || "").trim().toLowerCase(),
    String(data.dob || "").trim(),
  ].join("|");
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, ident);
  return digest.map((b) => (b & 0xff).toString(16).padStart(2, "0")).join("").slice(0, 16);
}

// =================================================================
// LOCK + ERROR LOG HELPERS
// =================================================================
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  // 5s is enough for any single Sheet append; raise if we ever see contention.
  lock.waitLock(5000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// Append to an _errors tab so failures survive Stackdriver's 30-day retention.
// Best-effort: never throws — used in catch blocks.
function logError_(ref, where, err) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    let tab = ss.getSheetByName(CONFIG.ERRORS_TAB_NAME);
    if (!tab) {
      tab = ss.insertSheet(CONFIG.ERRORS_TAB_NAME);
      tab.getRange(1, 1, 1, 4).setValues([["timestamp", "ref", "where", "error"]]);
      tab.setFrozenRows(1);
      tab.getRange(1, 1, 1, 4).setFontWeight("bold");
    }
    tab.appendRow([
      new Date().toISOString(),
      ref || "",
      where || "",
      err && (err.stack || err.message || String(err)) || "",
    ]);
  } catch (_) {
    // swallow — last-resort logger; don't recurse
  }
}

// =================================================================
// JSON RESPONSE
// =================================================================
// Apps Script ContentService cannot set HTTP status codes from a Web App
// return path, so the client branches on the JSON body's `ok`/`error` fields.
function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// =================================================================
// MANUAL UTILITIES — run from the Apps Script editor as needed
// =================================================================

/** One-time: create headers row + apply readable column number formats. */
function setupSheet() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  let sheet = ss.getSheetByName(CONFIG.SHEET_TAB_NAME);
  if (!sheet) sheet = ss.insertSheet(CONFIG.SHEET_TAB_NAME);
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");

  // Human-readable column formats. Cell number format only applies when the
  // cell contains a date/number value (not a string), so this works with
  // appendRow_ writing `new Date()` for submitted_at.
  const dateTimeCols = ["submitted_at"];
  const dateCols = ["intake_date", "dob", "immigrant_date", "signature_date"];
  dateTimeCols.forEach((h) => {
    const i = HEADERS.indexOf(h);
    if (i >= 0) sheet.getRange(2, i + 1, sheet.getMaxRows() - 1, 1)
      .setNumberFormat("yyyy-mm-dd  h:mm am/pm");
  });
  dateCols.forEach((h) => {
    const i = HEADERS.indexOf(h);
    if (i >= 0) sheet.getRange(2, i + 1, sheet.getMaxRows() - 1, 1)
      .setNumberFormat("yyyy-mm-dd");
  });

  try { SpreadsheetApp.getUi().alert("Sheet headers written."); } catch (_) {}
  console.log("Sheet headers + column formats applied.");
}

/**
 * Daily heartbeat — run once daily via a time-driven trigger.
 * Mails the count of yesterday's submissions to NOTIFY_EMAIL so a silent
 * outage (Apps Script broken / mail quota burned) shows up as a missing
 * email rather than a missing submission.
 *
 * Public (no trailing underscore) so it appears in the Triggers dropdown.
 *
 * To install: Apps Script editor → Triggers (clock icon) → Add Trigger
 *   Function: dailyHealthCheck
 *   Event source: Time-driven
 *   Type: Day timer, "Between 8am and 9am"
 */
function dailyHealthCheck() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_TAB_NAME);
  if (!sheet) return;
  const submittedAtCol = HEADERS.indexOf("submitted_at") + 1;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    MailApp.sendEmail({
      to: CONFIG.NOTIFY_EMAIL,
      subject: "CSC Workforce Intake — no submissions yet",
      body: "Sheet is empty. If this is unexpected, check the deployment.",
    });
    return;
  }
  const stamps = sheet.getRange(2, submittedAtCol, lastRow - 1, 1).getValues();
  const now = new Date();
  const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let count = 0;
  stamps.forEach(([s]) => {
    const t = s instanceof Date ? s : new Date(s);
    if (!isNaN(t) && t >= startOfYesterday && t < startOfToday) count++;
  });
  MailApp.sendEmail({
    to: CONFIG.NOTIFY_EMAIL,
    subject: `CSC Workforce Intake — ${count} submission(s) yesterday`,
    body: `Yesterday (${startOfYesterday.toDateString()}): ${count} new intake(s).\n\nSheet: https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/edit`,
  });
}

/** Quick test — paste into the editor + run to verify your config. */
function testSubmit() {
  const fakePayload = {
    postData: {
      contents: JSON.stringify({
        action: "submit",
        idempotency_key: Utilities.getUuid(),
        data: {
          last_name: "Test",
          first_name: "Demo",
          dob: "1980-01-01",
          phone: "(213) 555-0100",
          email: "demo@example.com",
          services: ["job_search", "resume_review"],
        },
        signature: "",
        meta: { lang: "zh", mode: "staff" },
      }),
    },
    parameter: {},
  };
  const res = doPost(fakePayload);
  Logger.log(res.getContent());
}
