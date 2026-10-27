// SchoolRating.eu – shared helpers for the survey, results portal and admin pages.
"use strict";

(function () {
  /** API origin: same origin on the Worker / local dev; the deployed Worker from GitHub Pages (ai-kasy.online). */
  const WORKER_ORIGIN = "https://aiva.radilov-k.workers.dev";
  function apiBase() {
    const h = location.hostname;
    // same origin on schoolrating.eu, *.workers.dev and locally; the old static copy on GitHub Pages calls the Worker
    return h.endsWith("ai-kasy.online") || h.endsWith("github.io") ? WORKER_ORIGIN : "";
  }

  class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }

  const FRIENDLY = {
    "unknown code": "Не намираме такъв код. Проверете дали е преписан точно – буквите и цифрите от листчето.",
    "code already used": "С този код вече е попълнена анкета. Всеки код се използва само веднъж.",
    "no computed wave": "Все още няма публикувани резултати.",
    "not found or not permitted": "Тези резултати не са достъпни с вашия достъп.",
  };

  async function api(path, { method = "GET", body, key } = {}) {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (key) headers.Authorization = "Bearer " + key;
    let r;
    try {
      r = await fetch(apiBase() + "/api/sf" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      throw new ApiError(0, "Няма връзка със сървъра. Проверете интернета и опитайте отново.");
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(r.status, FRIENDLY[data.error] || data.error || "Нещо се обърка (" + r.status + "). Опитайте отново.");
    return data;
  }

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (x, d = 1) => (x === null || x === undefined || Number.isNaN(x) ? "–" : Number(x).toFixed(d).replace(".", ","));
  const pct = (x) => (x === null || x === undefined ? "–" : Math.round(x * 100) + "%");

  function store(kind) {
    const s = kind === "local" ? window.localStorage : window.sessionStorage;
    return {
      get(k) { try { return JSON.parse(s.getItem(k) || "null"); } catch (e) { return null; } },
      set(k, v) { try { s.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
      del(k) { try { s.removeItem(k); } catch (e) { /* ignore */ } },
    };
  }

  let toastTimer = null;
  function toast(msg) {
    let el = document.querySelector(".toast");
    if (!el) { el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  /** Bulgarian plural: plural(5, "отговор", "отговора") -> "5 отговора". */
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  const ICON = {
    // emblem: a shield holding an open book
    mark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.8l7.5 2.7v6.1c0 4.6-3.1 7.9-7.5 9.6-4.4-1.7-7.5-5-7.5-9.6V5.5z"/><path d="M12 9.2c-1.4-1-3-1.3-4.6-1.1v6.6c1.6-.2 3.2.1 4.6 1.1 1.4-1 3-1.3 4.6-1.1V8.1c-1.6-.2-3.2.1-4.6 1.1z"/><path d="M12 9.2v6.6"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2v.1"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5z"/><path d="M12 6.5v13"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3 19.5c.6-3.3 3-5.2 6-5.2s5.4 1.9 6 5.2"/><path d="M15.5 4.9a3.2 3.2 0 0 1 0 6.2M17.5 14.5c1.9.7 3.1 2.4 3.5 5"/></svg>',
    building: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 20.5h18M5 20.5V9.5l7-5 7 5v11"/><path d="M9 20.5v-5h6v5M9 11.5h.01M15 11.5h.01"/></svg>',
  };

  /** Organisation details (org.js) into [data-org]; an empty field reads "предстои", never an invented value. */
  function fillOrg(root = document) {
    const o = window.SF_ORG || {};
    for (const el of root.querySelectorAll("[data-org]")) {
      const v = o[el.dataset.org] || (el.dataset.fallback && o[el.dataset.fallback]) || "";
      if (!v) {
        const dd = el.closest("dd");
        if (dd) { dd.hidden = true; if (dd.previousElementSibling?.tagName === "DT") dd.previousElementSibling.hidden = true; }
        else el.innerHTML = '<span class="todo">предстои</span>';
        continue;
      }
      if (/email$/.test(el.dataset.org) || /@/.test(v)) el.innerHTML = `<a href="mailto:${esc(v)}">${esc(v)}</a>`;
      else el.textContent = v;
    }
    for (const el of root.querySelectorAll("[data-org-line]")) el.hidden = !o[el.dataset.orgLine];
    for (const el of root.querySelectorAll("[data-org-href]")) { const v = o[el.dataset.orgHref]; if (v) el.href = v; else el.hidden = true; }
  }

  function fillIcons(root = document) {
    for (const el of root.querySelectorAll("[data-icon]")) if (!el.querySelector("svg")) el.innerHTML = ICON[el.dataset.icon] || "";
    for (const el of root.querySelectorAll("[data-i]")) if (!el.querySelector("svg")) el.insertAdjacentHTML("afterbegin", ICON[el.dataset.i] || "");
  }

  /** Proof of work for actions without a code (see /api/sf/pow): ~33k SHA-256, under a second, done in the background. */
  let powJob = null;
  function pow() {
    if (powJob && Date.now() - powJob.at < 10 * 60 * 1000) return powJob.p;
    const p = (async () => {
      const { challenge, bits } = await api("/pow");
      const enc = new TextEncoder();
      const zeros = (b) => { let n = 0; for (const x of b) { if (x === 0) { n += 8; continue; } return n + Math.clz32(x) - 24; } return n; };
      for (let base = 0; base < 1e9; base += 512) {
        const hs = await Promise.all(Array.from({ length: 512 }, (_, i) => crypto.subtle.digest("SHA-256", enc.encode(`${challenge}:${base + i}`))));
        for (let i = 0; i < hs.length; i++) if (zeros(new Uint8Array(hs[i])) >= bits) return { challenge, nonce: String(base + i) };
      }
      throw new Error("Проверката не успя.");
    })();
    powJob = { at: Date.now(), p };
    p.catch(() => { powJob = null; });
    return p;
  }
  /** A solved challenge is accepted once: start the next one for a later action. */
  const powUsed = () => { powJob = null; };

  /** QR code as inline SVG (lib/qrcode.js, MIT); empty string if the library is not on the page. */
  function qrSvg(text, cell = 4) {
    if (!window.qrcode) return "";
    const q = window.qrcode(0, "M");
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: cell, margin: 2, scalable: true });
  }

  /** Public survey address of a school (what its QR code points to). */
  const schoolLink = (id) => new URL(`survey.html?s=${encodeURIComponent(id)}`, location.href).href;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { fillOrg(); fillIcons(); });
  else { fillOrg(); fillIcons(); }

  window.SF = { api, ApiError, esc, fmt, pct, store, toast, plural, ICON, apiBase, fillOrg, fillIcons, pow, powUsed, qrSvg, schoolLink };
})();
