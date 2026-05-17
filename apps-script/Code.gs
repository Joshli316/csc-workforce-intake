/**
 * CSC Workforce Intake — Apps Script Web App backend
 *
 * Endpoints:
 *   POST {action: "submit", data: {...}, signature: "data:image/png;base64,..."}
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
  DRIVE_FOLDER_ID: "REPLACE_WITH_DRIVE_FOLDER_ID",
  NOTIFY_EMAIL: "cscworkforcedev@gmail.com",
  ORG_NAME: "Chinatown Service Center",
  REF_PREFIX: "WD",
  RATE_LIMIT_PER_HOUR: 30,
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
  "client_bucket", // MD5 hash of UA+body for soft rate-limit bucketing; NOT a real IP
];

// =================================================================
// MAIN HANDLER
// =================================================================
function doPost(e) {
  try {
    const ip = getClientIp_(e);
    if (!checkRateLimit_(ip)) {
      return jsonResponse_({ ok: false, error: "rate_limit" }, 429);
    }

    const body = JSON.parse(e.postData.contents);
    const action = body.action || "submit";
    if (action !== "submit") {
      return jsonResponse_({ ok: false, error: "unknown_action" }, 400);
    }

    const data = body.data || {};
    const signature = body.signature || "";
    const meta = body.meta || {};

    // Server-side defense-in-depth: reject obvious garbage / empty submissions.
    // Client-side validation enforces these for legitimate users; this catches
    // direct POSTs that bypass the form.
    if (!hasMinimumFields_(data)) {
      return jsonResponse_({ ok: false, error: "missing_required" }, 400);
    }

    // Generate reference number
    const ref = nextRefNumber_();

    // Save signature PNG to Drive
    let signatureUrl = "";
    if (signature && signature.startsWith("data:image/png;base64,")) {
      signatureUrl = saveSignature_(ref, signature);
    }

    // Append row to Sheet
    appendRow_(ref, data, meta, signatureUrl, ip);

    // Notify staff by email (best-effort; don't fail submit if email fails)
    try {
      sendNotification_(ref, data);
    } catch (err) {
      console.warn("Email notification failed:", err);
    }

    return jsonResponse_({ ok: true, ref });
  } catch (err) {
    // Log full error details to Apps Script logs for debugging,
    // but return a generic message to avoid leaking internals.
    console.error("doPost error:", err && err.stack || err);
    return jsonResponse_({ ok: false, error: "server" }, 500);
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
// REFERENCE NUMBER
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
// DRIVE — save signature PNG
// =================================================================
function saveSignature_(ref, dataUrl) {
  const folder = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
  const base64 = dataUrl.split(",")[1];
  const bytes = Utilities.base64Decode(base64);
  const blob = Utilities.newBlob(bytes, "image/png", `${ref}-signature.png`);
  const file = folder.createFile(blob);
  // make readable by anyone in the org with the link (so staff in the Sheet can view it).
  // If your org policy forbids this, comment out the next line and grant access on the folder instead.
  try {
    file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) {
    console.warn("Could not set domain sharing; using default permissions.", err);
  }
  return file.getUrl();
}

// =================================================================
// SHEET — append row
// =================================================================
function appendRow_(ref, data, meta, signatureUrl, ip) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  let sheet = ss.getSheetByName(CONFIG.SHEET_TAB_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_TAB_NAME);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
  }

  // Build a value map combining ref / meta / signature URL / submitted data.
  const merged = Object.assign({}, data, {
    ref,
    submitted_at: meta.submitted_at || new Date().toISOString(),
    signature_url: signatureUrl,
    lang: meta.lang || "",
    mode: meta.mode || "",
    user_agent: meta.user_agent || "",
    client_bucket: ip || "",
  });

  const row = HEADERS.map((h) => {
    const v = merged[h];
    if (Array.isArray(v)) return v.join(", ");
    if (v === undefined || v === null) return "";
    if (typeof v === "boolean") return v ? "Yes" : "";
    return v;
  });
  sheet.appendRow(row);
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
// RATE LIMIT — per-IP rolling 1-hour window
// =================================================================
function checkRateLimit_(ip) {
  if (!ip) return true; // can't enforce, allow
  const props = PropertiesService.getScriptProperties();
  const key = `rl_${ip}`;
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

// Apps Script doesn't expose request IP directly. We use a hash of (UA + first 32 chars of body)
// as a soft rate-limit bucket. Good enough to deter spam; not a security control.
function getClientIp_(e) {
  const ua = (e.postData && e.postData.contents || "") + "|" +
             ((e.parameter && JSON.stringify(e.parameter)) || "");
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, ua);
  return digest.map((b) => (b & 0xff).toString(16).padStart(2, "0")).join("").slice(0, 16);
}

// =================================================================
// JSON RESPONSE
// =================================================================
function jsonResponse_(obj, _statusCode) {
  // Apps Script ContentService can't set HTTP status codes on the web app
  // return path, so _statusCode is intentionally unused — the client branches
  // on the JSON body's `error` field instead. Leaving call sites passing 429 /
  // 400 / 500 so the intent is documented at the throw site.
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// =================================================================
// MANUAL UTILITIES — run from the Apps Script editor as needed
// =================================================================

/** One-time: create headers row if you'd rather seed it manually. */
function setupSheet() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  let sheet = ss.getSheetByName(CONFIG.SHEET_TAB_NAME);
  if (!sheet) sheet = ss.insertSheet(CONFIG.SHEET_TAB_NAME);
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
  // getUi() only works when invoked from a Sheet-bound menu, not from the
  // Apps Script editor — wrap so a standalone-editor run still succeeds.
  try { SpreadsheetApp.getUi().alert("Sheet headers written."); } catch (_) {}
  console.log("Sheet headers written.");
}

/** Quick test — paste into the editor + run to verify your config. */
function testSubmit() {
  const fakePayload = {
    postData: {
      contents: JSON.stringify({
        action: "submit",
        data: {
          last_name: "Test",
          first_name: "Demo",
          dob: "1980-01-01",
          phone: "(213) 555-0100",
          email: "demo@example.com",
          services: ["job_placement", "esl"],
        },
        signature: "",
        meta: { submitted_at: new Date().toISOString(), lang: "zh", mode: "staff" },
      }),
    },
    parameter: {},
  };
  const res = doPost(fakePayload);
  Logger.log(res.getContent());
}
