/* =================================================================
   CSC Workforce Intake — client-side logic
   ================================================================= */

// Paste the Apps Script Web App /exec URL here after deploying.
// Leave blank during local dev — the form will run in "preview" mode and
// log the payload instead of POSTing.
const APPS_SCRIPT_URL = "";
// Optional: link staff to the Google Sheet from the footer in staff mode.
// Leave blank to hide the link.
const SUBMISSIONS_SHEET_URL = "";

const STORAGE_KEY_DRAFT = "workforceIntakeDraft";
const STORAGE_KEY_LANG = "workforceIntakeLang";
const STORAGE_KEY_STAFF = "workforceIntakeStaffName";

const I18N = {
  errors: {
    required: { en: "This field is required.", zh: "此欄位為必填。" },
    requiredPlural: { en: "Please complete the highlighted fields.", zh: "請填寫標示的欄位。" },
    phone: { en: "Please enter a valid phone number.", zh: "請輸入有效的電話號碼。" },
    email: { en: "Please enter a valid email.", zh: "請輸入有效的電子郵件。" },
    dob: { en: "Please enter a valid date of birth.", zh: "請輸入有效的出生日期。" },
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
    retry: { en: "Try again", zh: "重新嘗試" },
    confirmClear: { en: "Clear all entered data and start over?", zh: "確定要清除所有資料並重新開始嗎？" },
    previewMode: {
      en: "Preview mode — backend not yet configured. Submission was logged to the console.",
      zh: "預覽模式 — 後端尚未設定。提交資料已輸出至 console。",
    },
  },
};

const REQUIRED_FIELDS = ["last_name", "first_name", "dob", "phone", "signature_date"];

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

  // staff defaults: today's date + remembered staff name
  if (mode === "staff") {
    const d = new Date();
    const today = d.toISOString().slice(0, 10);
    const intake = document.getElementById("intake_date");
    if (intake && !intake.value) intake.value = today;
    const sig = document.getElementById("signature_date");
    if (sig && !sig.value) sig.value = today;
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
    if (!fill) return;
    const pct = ((this.index) / (this.steps.length - 1)) * 100;
    fill.style.width = `${pct}%`;
  },

  showSuccess() {
    document.querySelectorAll(".form-section").forEach((s) => s.classList.remove("is-active"));
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

  const phone = section.querySelector('input[name="phone"]');
  if (phone && phone.value.trim() && !isValidPhone(phone.value)) {
    setFieldError(phone, I18N.errors.phone[lang]);
    if (!firstError) firstError = phone;
  }
  const email = section.querySelector('input[name="email"]');
  if (email && email.value.trim() && !isValidEmail(email.value)) {
    setFieldError(email, I18N.errors.email[lang]);
    if (!firstError) firstError = email;
  }

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

  const phone = form.elements["phone"];
  if (phone && phone.value.trim() && !isValidPhone(phone.value)) {
    setFieldError(phone, I18N.errors.phone[lang]);
    if (!firstError) firstError = phone;
  }
  const email = form.elements["email"];
  if (email && email.value.trim() && !isValidEmail(email.value)) {
    setFieldError(email, I18N.errors.email[lang]);
    if (!firstError) firstError = email;
  }

  // consent + signature
  const consent = form.elements["consent"];
  let consentErr = null;
  if (consent && !consent.checked) {
    consentErr = I18N.errors.consent[lang];
    consent.closest(".check")?.classList.add("has-error");
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
    const dpr = window.devicePixelRatio || 1;
    // preserve current drawing
    const tmp = document.createElement("canvas");
    tmp.width = canvas.width; tmp.height = canvas.height;
    tmp.getContext("2d").drawImage(canvas, 0, 0);
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1A1A1A";
    if (hasInk) {
      ctx.drawImage(tmp, 0, 0, rect.width, rect.height);
    }
  }

  function getPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e) {
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
// AUTOSAVE — every input change, debounced
// =================================================================
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraft, 500);
}
function saveDraft() {
  try {
    const data = collectFormData();
    delete data.signature; // signature pixels don't autosave
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

  // group checkboxes that share a name
  const multi = new Set();
  form.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    const others = form.querySelectorAll(`input[type="checkbox"][name="${cb.name}"]`);
    if (others.length > 1) multi.add(cb.name);
  });

  for (const key of fd.keys()) {
    if (multi.has(key)) {
      data[key] = fd.getAll(key);
    } else {
      data[key] = fd.get(key);
    }
  }
  // single checkboxes that are unchecked don't appear in FormData — record them
  form.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    if (multi.has(cb.name)) return;
    data[cb.name] = cb.checked;
  });
  return data;
}

// =================================================================
// SUBMIT
// =================================================================
async function handleSubmit(e) {
  e.preventDefault();
  if (!validateAll()) return;

  const submitBtn = document.getElementById("submitBtn");
  const lang = getLang();
  submitBtn.disabled = true;
  submitBtn.classList.add("is-loading");
  const label = submitBtn.querySelector(".btn__label");
  if (label) label.textContent = I18N.labels.submitting[lang];

  const payload = {
    action: "submit",
    data: collectFormData(),
    signature: signaturePad.toDataURL(),
    meta: {
      submitted_at: new Date().toISOString(),
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
      const res = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        // Apps Script web apps prefer text/plain to bypass CORS preflight
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
      });
      if (res.status === 429) {
        throw new Error("rate_limit");
      }
      if (!res.ok) {
        throw new Error("server");
      }
      result = await res.json();
      if (!result.ok) {
        throw new Error(result.error || "server");
      }
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
  }
}

function onSubmitSuccess(result) {
  clearDraft();
  // signature can be cleared from screen
  signaturePad.clear();

  // populate ref badge
  const refEl = document.getElementById("refBadge");
  if (refEl) refEl.textContent = result.ref || "—";

  // QR code linking back to the form (so staff can hand the phone to next client)
  const qrBlock = document.getElementById("successQr");
  const qrImg = document.getElementById("qrImg");
  if (qrBlock && qrImg) {
    try {
      const baseUrl = `${location.origin}${location.pathname}`;
      const encoded = encodeURIComponent(baseUrl);
      qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encoded}`;
      qrBlock.hidden = false;
    } catch (_) { /* QR is decorative — ignore failures */ }
  }

  // if preview, show a notice at top of success screen
  if (result.preview) {
    const lang = getLang();
    const notice = document.createElement("div");
    notice.className = "error-summary";
    notice.style.color = "#854D0E";
    notice.style.background = "#FEF9C3";
    notice.style.borderColor = "#EAB308";
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

  // mode
  applyMode();

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

  // autosave
  form.addEventListener("input", scheduleSave);
  form.addEventListener("change", scheduleSave);

  // restore draft
  restoreDraft();

  // staff default dates after restore (don't overwrite if user already had values)
  if (getMode() === "staff") {
    // already handled in applyMode but call again in case input was empty after restore
    applyMode();
  }

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

  // pre-fill today's signature date in client mode if blank (helps clients who skip it)
  const sigDate = document.getElementById("signature_date");
  if (sigDate && !sigDate.value) {
    sigDate.value = new Date().toISOString().slice(0, 10);
  }
});
