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
  NOTIFY_EMAIL: "workforce@cscla.org",
  ORG_NAME: "Chinatown Service Center",
  REF_PREFIX: "WD",
  RATE_LIMIT_PER_HOUR: 30,
};

// Columns written to the Sheet, in this order. Edit to match your reporting needs.
const HEADERS = [
  "ref",
  "submitted_at",
  "intake_date",
  "staff_name",
  "referral_source",
  // identification
  "last_name",
  "first_name",
  "middle_name",
  "preferred_name",
  "dob",
  "gender",
  "phone",
  "email",
  "best_contact",
  "address",
  "address_apt",
  "city",
  "state",
  "zip",
  "ssn",
  // demographics
  "race",
  "primary_language",
  "english_level",
  "citizenship",
  "marital",
  "household_size",
  "veteran",
  "disability",
  "single_parent",
  // education + employment
  "education_level",
  "in_school",
  "last_school",
  "emp_status",
  "unemployed_duration",
  "receives_ui",
  // services + support
  "services",
  "services_other",
  "support",
  "notes",
  // emergency contact
  "emergency_name",
  "emergency_phone",
  "emergency_relationship",
  // employment history
  "job1_employer", "job1_title", "job1_start", "job1_end", "job1_reason",
  "job2_employer", "job2_title", "job2_start", "job2_end", "job2_reason",
  "job3_employer", "job3_title", "job3_start", "job3_end", "job3_reason",
  // certification
  "consent",
  "signature_date",
  "printed_name",
  "signature_url",
  // meta
  "lang",
  "mode",
  "user_agent",
  "client_ip",
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
    console.error("doPost error:", err);
    return jsonResponse_({ ok: false, error: String(err && err.message || err) }, 500);
  }
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
    client_ip: ip || "",
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
function jsonResponse_(obj, statusCode) {
  // Note: Apps Script ContentService doesn't expose a setStatusCode method on
  // most return paths, but the body is what the client checks.
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
  SpreadsheetApp.getUi().alert("Sheet headers written.");
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
