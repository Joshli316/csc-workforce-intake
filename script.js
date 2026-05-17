/* =================================================================
   CSC Workforce Intake — client-side logic
   ================================================================= */

// Paste the Apps Script Web App /exec URL here after deploying.
// Leave blank during local dev — the form will run in "preview" mode and
// log the payload instead of POSTing.
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzHC7XXw01KHuZLGSfbkyZAmgYncVe_HUgeJYLekRIg5ef0lwPPQHblje1iHLpo3l-bmw/exec";
// Optional: link staff to the Google Sheet from the footer in staff mode.
// Leave blank to hide the link.
const SUBMISSIONS_SHEET_URL = "https://docs.google.com/spreadsheets/d/1oHxWDlrNxSkMquUPksB4s4ckxFe9QVlphPTDjOKc-ns/edit";

const STORAGE_KEY_DRAFT = "workforceIntakeDraft";
const STORAGE_KEY_LANG = "workforceIntakeLang";
const STORAGE_KEY_STAFF = "workforceIntakeStaffName";

const I18N = {
  errors: {
    required: { en: "This field is required.", zh: "此欄位為必填。" },
    phone: { en: "Please enter a valid phone number.", zh: "請輸入有效的電話號碼。" },
    email: { en: "Please enter a valid email.", zh: "請輸入有效的電子郵件。" },
    consent: { en: "Please confirm you have read the certification.", zh: "請確認您已閱讀證明聲明。" },
    signature: { en: "Please add your signature.", zh: "請簽名。" },
    network: { en: "Could not submit. Please check your connection and try again.", zh: "提交失敗。請檢查網路連線後再試。" },
    server: { en: "The server returned an error. Please try again.", zh: "伺服器發生錯誤。請再試一次。" },
    rateLimit: { en: "Too many submissions from this network. Please wait a few minutes.", zh: "短時間內提交次數過多，請稍候再試。" },
  },
  labels: {
    fixThese: { en: "Please fix the following:", zh: "請修正以下項目：" },
    submitting: { en: "Submitting…", zh: "提交中…" },
    submit: { en: "Submit Form", zh: "提交表格" },
    confirmClear: { en: "Clear all entered data and start over?", zh: "確定要清除所有資料並重新開始嗎？" },
    previewMode: {
      en: "Preview mode — backend not yet configured. Submission was logged to the console.",
      zh: "預覽模式 — 後端尚未設定。提交資料已輸出至 console。",
    },
  },
};

const REQUIRED_FIELDS = ["last_name", "first_name", "dob", "phone", "printed_name", "signature_date"];

// Labels for the step indicator above the progress bar — section names
// match the PDF's section headings verbatim (parity-locked) so this is
// safe to display without disturbing form copy.
const STEP_NAMES = {
  identification:    { en: "Identification",            zh: "個人資料" },
  demographics:      { en: "Demographics",              zh: "人口統計資料" },
  education:         { en: "Education",                 zh: "教育背景" },
  services:          { en: "Requested Services",        zh: "申請服務項目" },
  support_needs:     { en: "Additional Support Needs",  zh: "額外支援需求" },
  contacts_history:  { en: "Emergency Contact",         zh: "緊急聯絡人" },
  certification:    { en: "Certification",              zh: "聲明與確認" },
};

const SUBMIT_TIMEOUT_MS = 30000;

// =================================================================
// LANGUAGE
// =================================================================
function applyLang(lang) {
  const isZh = lang === "zh";
  document.documentElement.lang = isZh ? "zh-Hant" : "en";

  // text content
  document.querySelectorAll("[data-en][data-zh]").forEach((el) => {
    const txt = el.getAttribute(isZh ? "data-zh" : "data-en");
    if (txt != null) el.textContent = txt;
  });
  // placeholders
  document.querySelectorAll("[data-en-placeholder][data-zh-placeholder]").forEach((el) => {
    const p = el.getAttribute(isZh ? "data-zh-placeholder" : "data-en-placeholder");
    if (p != null) el.placeholder = p;
  });
  // language toggle button state
  document.querySelectorAll(".lang-toggle__btn").forEach((b) => {
    b.setAttribute("aria-pressed", b.dataset.lang === lang ? "true" : "false");
  });
  // refresh submit button label (it has a child span)
  const submitLabel = document.querySelector("#submitBtn .btn__label");
  if (submitLabel) submitLabel.textContent = I18N.labels.submit[lang];

  try { localStorage.setItem(STORAGE_KEY_LANG, lang); } catch (_) {}
}

function getLang() {
  return document.documentElement.lang.startsWith("zh") ? "zh" : "en";
}

// =================================================================
// MODE (client / staff)
// =================================================================
function getMode() {
  const p = new URLSearchParams(location.search).get("mode");
  return p === "staff" ? "staff" : "client";
}

function applyMode() {
  const mode = getMode();
  document.body.dataset.mode = mode;

  // mode toggle text in footer
  const link = document.getElementById("modeToggle");
  if (link) {
    if (mode === "staff") {
      link.href = "?mode=client";
      link.setAttribute("data-en", "Switch to client mode");
      link.setAttribute("data-zh", "切換至客戶模式");
    } else {
      link.href = "?mode=staff";
      link.setAttribute("data-en", "Switch to staff mode");
      link.setAttribute("data-zh", "切換至工作人員模式");
    }
  }

  if (mode === "staff") {
    const staff = document.getElementById("staff_name");
    try {
      const saved = localStorage.getItem(STORAGE_KEY_STAFF);
      if (staff && !staff.value && saved) staff.value = saved;
    } catch (_) {}
    if (staff) {
      staff.addEventListener("input", () => {
        try { localStorage.setItem(STORAGE_KEY_STAFF, staff.value); } catch (_) {}
      });
    }
  }
}

// Pre-fill today's date into intake_date and signature_date if blank.
// Applies in both client and staff modes — the three intake-header fields
// are now visible to clients too, and "today" is the right default for an
// in-person intake. Idempotent so it can run after restoreDraft.
function applyIntakeDateDefaults() {
  const today = new Date().toISOString().slice(0, 10);
  const intake = document.getElementById("intake_date");
  if (intake && !intake.value) intake.value = today;
  const sig = document.getElementById("signature_date");
  if (sig && !sig.value) sig.value = today;
}

// =================================================================
// WIZARD
// =================================================================
const wizard = {
  steps: [], // sections that participate in the wizard (client mode)
  index: 0,

  init() {
    if (getMode() === "staff") return;
    this.steps = Array.from(document.querySelectorAll(".form-section[data-step]"))
      .filter((s) => {
        const k = s.dataset.step;
        return k !== "meta" && k !== "success";
      });
    // make sure we start at step 0
    this.show(0);
  },

  show(i) {
    this.index = Math.max(0, Math.min(i, this.steps.length - 1));
    this.steps.forEach((s, idx) => {
      s.classList.toggle("is-active", idx === this.index);
    });
    this.updateProgress();
    window.scrollTo({ top: 0, behavior: "smooth" });
    // Move focus to the new step's heading so screen readers announce the
    // transition. Set tabindex first since H2s aren't natively focusable.
    const heading = this.steps[this.index].querySelector("h1, h2");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }
  },

  next() {
    // validate current step before advancing (skip on welcome step)
    if (this.index > 0 && !validateStep(this.steps[this.index])) return;
    if (this.index < this.steps.length - 1) this.show(this.index + 1);
  },

  back() {
    if (this.index > 0) this.show(this.index - 1);
  },

  updateProgress() {
    const fill = document.getElementById("progressFill");
    if (fill) {
      const pct = ((this.index) / (this.steps.length - 1)) * 100;
      fill.style.width = `${pct}%`;
    }
    // Step counter "Step 2 of 6 · Identification" — hidden on welcome step.
    const indicator = document.getElementById("stepIndicator");
    const countEl = document.getElementById("stepIndicatorCount");
    const nameEl = document.getElementById("stepIndicatorName");
    if (indicator && countEl && nameEl) {
      const formSteps = this.steps.length - 1; // excludes welcome
      if (this.index === 0) {
        indicator.hidden = true;
      } else {
        indicator.hidden = false;
        const lang = getLang();
        countEl.textContent = lang === "zh"
          ? `第 ${this.index} 步，共 ${formSteps} 步`
          : `Step ${this.index} of ${formSteps}`;
        const sectionName = this.steps[this.index].dataset.sectionName || "";
        nameEl.textContent = STEP_NAMES[sectionName]
          ? STEP_NAMES[sectionName][lang]
          : "";
      }
    }
  },

  showSuccess() {
    document.querySelectorAll(".form-section").forEach((s) => s.classList.remove("is-active"));
    // In staff mode, every form section is display:block — hide the whole form
    // so the success card stands alone (without the stale "Submitting..." button
    // and filled fields showing above it).
    const form = document.getElementById("intakeForm");
    if (form) form.hidden = true;
    const success = document.querySelector('.form-section[data-step="success"]');
    if (success) {
      success.hidden = false;
      success.classList.add("is-active");
    }
    const fill = document.getElementById("progressFill");
    if (fill) fill.style.width = "100%";
    window.scrollTo({ top: 0, behavior: "smooth" });
  },
};

// =================================================================
// VALIDATION
// =================================================================
function clearErrors(scope) {
  (scope || document).querySelectorAll(".field.has-error").forEach((f) => {
    f.classList.remove("has-error");
    const err = f.querySelector(".field-error");
    if (err) err.remove();
  });
  const pad = document.querySelector(".signature-pad");
  if (pad) pad.classList.remove("has-error");
  const summary = document.getElementById("errorSummary");
  if (summary) { summary.hidden = true; summary.innerHTML = ""; }
}

function setFieldError(input, msg) {
  const field = input.closest(".field");
  if (!field) return;
  field.classList.add("has-error");
  let err = field.querySelector(".field-error");
  if (!err) {
    err = document.createElement("span");
    err.className = "field-error";
    field.appendChild(err);
  }
  err.textContent = msg;
}

// Returns the input if its format is invalid (and tags the field with the error),
// or null if absent/blank/valid. Lets callers chain `firstError ||= checkFormat(...)`.
function checkFormat(input, validator, errorKey, lang) {
  if (!input || !input.value.trim() || validator(input.value)) return null;
  setFieldError(input, I18N.errors[errorKey][lang]);
  return input;
}

function validateStep(section) {
  const lang = getLang();
  let firstError = null;
  clearErrors(section);

  section.querySelectorAll("[required]").forEach((input) => {
    if (!input.value.trim()) {
      setFieldError(input, I18N.errors.required[lang]);
      if (!firstError) firstError = input;
    }
  });

  firstError = firstError || checkFormat(section.querySelector('input[name="phone"]'), isValidPhone, "phone", lang);
  firstError = firstError || checkFormat(section.querySelector('input[name="email"]'), isValidEmail, "email", lang);

  if (firstError) {
    firstError.focus({ preventScroll: false });
    return false;
  }
  return true;
}

function validateAll() {
  const lang = getLang();
  clearErrors();
  let firstError = null;
  const form = document.getElementById("intakeForm");

  REQUIRED_FIELDS.forEach((name) => {
    const input = form.elements[name];
    if (input && !input.value.trim()) {
      setFieldError(input, I18N.errors.required[lang]);
      if (!firstError) firstError = input;
    }
  });

  firstError = firstError || checkFormat(form.elements["phone"], isValidPhone, "phone", lang);
  firstError = firstError || checkFormat(form.elements["email"], isValidEmail, "email", lang);

  // consent + signature
  const consent = form.elements["consent"];
  let consentErr = null;
  if (consent && !consent.checked) {
    consentErr = I18N.errors.consent[lang];
  }
  let signatureErr = null;
  if (signaturePad.isEmpty()) {
    signatureErr = I18N.errors.signature[lang];
    document.querySelector(".signature-pad")?.classList.add("has-error");
  }

  const errs = [];
  document.querySelectorAll(".field.has-error .field-error").forEach((e) => errs.push(e.textContent));
  if (consentErr) errs.push(consentErr);
  if (signatureErr) errs.push(signatureErr);

  if (errs.length) {
    showErrorSummary(errs);
    if (firstError) firstError.focus();
    else if (signatureErr) document.querySelector(".signature-pad")?.scrollIntoView({ behavior: "smooth", block: "center" });
    return false;
  }
  return true;
}

function showErrorSummary(errs) {
  const lang = getLang();
  const box = document.getElementById("errorSummary");
  if (!box) return;
  box.hidden = false;
  box.innerHTML = `<div class="error-summary__title">${I18N.labels.fixThese[lang]}</div><ul>${errs.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>`;
  box.scrollIntoView({ behavior: "smooth", block: "center" });
}

function isValidPhone(v) {
  const digits = v.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}
function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// =================================================================
// SIGNATURE PAD
// =================================================================
const signaturePad = (() => {
  let canvas, ctx;
  let drawing = false;
  let hasInk = false;
  let lastX = 0, lastY = 0;

  function init() {
    canvas = document.getElementById("signaturePad");
    if (!canvas) return;
    ctx = canvas.getContext("2d");
    resize();
    window.addEventListener("resize", resize);
    // The canvas is inside a wizard step that's display:none until the user
    // advances. At init time its CSS box is 0x0, so resize() sets the pixel
    // buffer to 0x0 and strokes silently no-op. ResizeObserver re-fires resize()
    // when the canvas becomes visible (or any time its CSS box changes).
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(() => resize()).observe(canvas);
    }

    canvas.addEventListener("pointerdown", start);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("pointerleave", end);

    document.getElementById("clearSignature")?.addEventListener("click", () => {
      clear();
    });
  }

  function resize() {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return; // not yet in layout
    const dpr = window.devicePixelRatio || 1;
    // Preserve current drawing if there is one. drawImage() throws
    // INDEX_SIZE_ERR when source canvas is 0x0, so guard on prior dims.
    let tmp = null;
    if (canvas.width > 0 && canvas.height > 0 && hasInk) {
      tmp = document.createElement("canvas");
      tmp.width = canvas.width; tmp.height = canvas.height;
      tmp.getContext("2d").drawImage(canvas, 0, 0);
    }
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1A1A1A";
    if (tmp) {
      ctx.drawImage(tmp, 0, 0, rect.width, rect.height);
    }
  }

  function getPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e) {
    // Defensive: if the canvas was hidden at init() time (wizard step not yet
    // active), its pixel buffer may still be 0x0. Re-size before the first
    // stroke so strokes actually render.
    if (canvas.width === 0 || canvas.height === 0) resize();
    drawing = true;
    canvas.setPointerCapture?.(e.pointerId);
    const p = getPoint(e);
    lastX = p.x; lastY = p.y;
    // dot for taps
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.1, 0, Math.PI * 2);
    ctx.fillStyle = "#1A1A1A";
    ctx.fill();
    hasInk = true;
    document.querySelector(".signature-pad")?.classList.remove("has-error");
  }
  function move(e) {
    if (!drawing) return;
    const p = getPoint(e);
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastX = p.x; lastY = p.y;
  }
  function end() { drawing = false; }

  function clear() {
    if (!canvas || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    hasInk = false;
  }

  function isEmpty() { return !hasInk; }

  function toDataURL() {
    if (!canvas || isEmpty()) return "";
    return canvas.toDataURL("image/png");
  }

  return { init, clear, isEmpty, toDataURL };
})();

// =================================================================
// CONDITIONAL FIELDS — show/hide based on another field's value
// Triggered by data-show-if="fieldName=value" on any element.
// Reads form state via collectFormData() so the multi-value / checkbox
// / radio branching lives in exactly one place.
// =================================================================
let conditionalEls = [];
function applyConditionals() {
  if (!document.getElementById("intakeForm")) return;
  const data = collectFormData();
  conditionalEls.forEach((el) => {
    const [name, expected] = el.dataset.showIf.split("=");
    const v = data[name];
    el.hidden = Array.isArray(v) ? !v.includes(expected) : v !== expected;
  });
}

// =================================================================
// AUTOSAVE — every input change, debounced
// =================================================================
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraft, 500);
}
// Fields that must never persist in localStorage. SSN especially — a shared
// kiosk tablet could leak it to the next user via the autosaved draft.
const DRAFT_REDACT = ["ssn", "signature"];

function saveDraft() {
  try {
    const data = collectFormData();
    DRAFT_REDACT.forEach((k) => { delete data[k]; });
    localStorage.setItem(STORAGE_KEY_DRAFT, JSON.stringify(data));
  } catch (e) {
    console.warn("Draft save failed", e);
  }
}
function restoreDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DRAFT);
    if (!raw) return;
    const data = JSON.parse(raw);
    const form = document.getElementById("intakeForm");
    Object.entries(data).forEach(([name, val]) => {
      const input = form.elements[name];
      if (!input) return;
      if (input instanceof RadioNodeList || input.length > 1) {
        // checkbox group (multi-value)
        const values = Array.isArray(val) ? val : [val];
        Array.from(input).forEach((el) => {
          if (el.type === "checkbox" || el.type === "radio") {
            el.checked = values.includes(el.value);
          }
        });
      } else if (input.type === "checkbox") {
        input.checked = !!val;
      } else {
        input.value = val ?? "";
      }
    });
  } catch (e) {
    console.warn("Draft restore failed", e);
  }
}
function clearDraft() {
  try { localStorage.removeItem(STORAGE_KEY_DRAFT); } catch (_) {}
}

// =================================================================
// COLLECT FORM DATA
// =================================================================
function collectFormData() {
  const form = document.getElementById("intakeForm");
  const data = {};
  const fd = new FormData(form);

  // One pass: tally checkbox occurrences per name to find multi-value groups.
  const checkboxes = form.querySelectorAll('input[type="checkbox"]');
  const cbCounts = new Map();
  checkboxes.forEach((cb) => cbCounts.set(cb.name, (cbCounts.get(cb.name) || 0) + 1));

  for (const key of fd.keys()) {
    data[key] = cbCounts.get(key) > 1 ? fd.getAll(key) : fd.get(key);
  }
  // Single checkboxes that are unchecked don't appear in FormData — record them as false.
  checkboxes.forEach((cb) => {
    if (cbCounts.get(cb.name) === 1) data[cb.name] = cb.checked;
  });
  return data;
}

// =================================================================
// SUBMIT
// =================================================================
let isSubmitting = false;
async function handleSubmit(e) {
  e.preventDefault();
  // Single-flight guard — blocks rapid double-submit (e.g. Enter pressed twice
  // before the disabled button state propagates).
  if (isSubmitting) return;
  if (!validateAll()) return;
  isSubmitting = true;

  const submitBtn = document.getElementById("submitBtn");
  const lang = getLang();
  submitBtn.disabled = true;
  submitBtn.classList.add("is-loading");
  const label = submitBtn.querySelector(".btn__label");
  if (label) label.textContent = I18N.labels.submitting[lang];

  // Idempotency: stable per submit attempt, so a network-retry that lands
  // a second POST gets the cached ref instead of creating a duplicate row.
  // crypto.randomUUID is widely supported; fall back to Date.now()+random
  // for ancient browsers without breaking the submit.
  const idempotencyKey = (crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const payload = {
    action: "submit",
    idempotency_key: idempotencyKey,
    data: collectFormData(),
    signature: signaturePad.toDataURL(),
    meta: {
      lang,
      mode: getMode(),
      user_agent: navigator.userAgent,
    },
  };

  try {
    let result;
    if (!APPS_SCRIPT_URL) {
      console.log("[CSC intake — preview mode] payload:", payload);
      // simulate a ref number locally for visual testing
      const year = new Date().getFullYear();
      result = { ok: true, ref: `WD-${year}-PREVIEW`, preview: true };
    } else {
      // Bound the wait so a hung Apps Script call doesn't lock the
      // spinner forever — user sees a network error after 30s.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);
      let res;
      try {
        res = await fetch(APPS_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
      // Apps Script Web Apps always return 200 — error signal lives in the
      // JSON body's `ok` / `error` fields, not the HTTP status.
      if (!res.ok) throw new Error("server");
      result = await res.json();
      if (!result.ok) throw new Error(result.error || "server");
    }
    onSubmitSuccess(result);
  } catch (err) {
    console.error("Submit failed:", err);
    let msg = I18N.errors.network[lang];
    if (err.message === "rate_limit") msg = I18N.errors.rateLimit[lang];
    else if (err.message === "server") msg = I18N.errors.server[lang];
    showErrorSummary([msg]);
    submitBtn.disabled = false;
    submitBtn.classList.remove("is-loading");
    if (label) label.textContent = I18N.labels.submit[lang];
  } finally {
    isSubmitting = false;
  }
}

function onSubmitSuccess(result) {
  clearDraft();
  // signature can be cleared from screen
  signaturePad.clear();

  // populate ref badge
  const refEl = document.getElementById("refBadge");
  if (refEl) refEl.textContent = result.ref || "—";

  // QR code linking back to the form (so staff can hand the phone to next client).
  // If the QR service is blocked/offline, the URL text below stays visible so
  // staff can still hand over the link verbally or via copy/paste.
  const qrBlock = document.getElementById("successQr");
  const qrImg = document.getElementById("qrImg");
  const qrUrlLink = document.getElementById("qrUrl");
  if (qrBlock && qrImg && qrUrlLink) {
    const baseUrl = `${location.origin}${location.pathname}`;
    qrUrlLink.href = baseUrl;
    // Render the URL without the scheme so it scans visually like a hand-off card.
    qrUrlLink.textContent = baseUrl.replace(/^https?:\/\//, "");
    qrImg.onerror = () => qrImg.classList.add("is-hidden");
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encodeURIComponent(baseUrl)}`;
    qrBlock.hidden = false;
  }

  // if preview, show a notice at top of success screen
  if (result.preview) {
    const lang = getLang();
    const notice = document.createElement("div");
    notice.className = "error-summary error-summary--notice";
    notice.textContent = I18N.labels.previewMode[lang];
    document.querySelector(".section-card--success")?.prepend(notice);
  }

  wizard.showSuccess();
}

// =================================================================
// INIT
// =================================================================
document.addEventListener("DOMContentLoaded", () => {
  // language
  let lang = "zh";
  try {
    const saved = localStorage.getItem(STORAGE_KEY_LANG);
    if (saved === "en" || saved === "zh") lang = saved;
  } catch (_) {}
  applyLang(lang);

  document.querySelectorAll(".lang-toggle__btn").forEach((b) => {
    b.addEventListener("click", () => applyLang(b.dataset.lang));
  });

  // mode + staff defaults (date defaults run again post-restoreDraft, below)
  applyMode();
  applyIntakeDateDefaults();

  // wizard
  wizard.init();

  // wizard nav buttons (delegated)
  document.body.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    if (btn.dataset.action === "next") { e.preventDefault(); wizard.next(); }
    else if (btn.dataset.action === "back") { e.preventDefault(); wizard.back(); }
  });

  // signature pad
  signaturePad.init();

  // form submit
  const form = document.getElementById("intakeForm");
  form.addEventListener("submit", handleSubmit);

  // autosave fires on every input; conditional reveals only depend on radio /
  // checkbox / select values (which fire `change`), so we don't need to recompute
  // them on every keystroke in unrelated text fields.
  conditionalEls = Array.from(document.querySelectorAll("[data-show-if]"));
  form.addEventListener("input", scheduleSave);
  form.addEventListener("change", () => { scheduleSave(); applyConditionals(); });
  applyConditionals();

  // restore draft, then top up staff-mode date defaults (the draft may have
  // restored empty values that overrode the initial pre-fill)
  restoreDraft();
  applyIntakeDateDefaults();
  applyConditionals();

  // staff-mode footer: show "Open submissions Sheet" link if configured
  const sheetLink = document.getElementById("openSheet");
  if (sheetLink && getMode() === "staff" && SUBMISSIONS_SHEET_URL) {
    sheetLink.href = SUBMISSIONS_SHEET_URL;
    sheetLink.target = "_blank";
    sheetLink.rel = "noopener";
    sheetLink.hidden = false;
  }

  // footer actions
  document.getElementById("printBlank")?.addEventListener("click", () => window.print());
  document.getElementById("printConfirm")?.addEventListener("click", () => window.print());
  document.getElementById("clearDraft")?.addEventListener("click", () => {
    const lang = getLang();
    if (confirm(I18N.labels.confirmClear[lang])) {
      clearDraft();
      location.reload();
    }
  });
  document.getElementById("newForm")?.addEventListener("click", () => {
    clearDraft();
    location.reload();
  });

  // Cap date pickers at today so clients can't pick a future DOB or sign a
  // form dated 2099. iOS/Android pickers respect the max attribute.
  const today = new Date().toISOString().slice(0, 10);
  document.querySelectorAll('input[name="dob"], input[name="signature_date"], input[name="intake_date"]')
    .forEach((d) => d.setAttribute("max", today));
});
