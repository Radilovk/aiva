// Глас за училището – shared helpers for the survey, results portal and admin pages.
"use strict";

(function () {
  /** API origin: same origin on the Worker / local dev; the deployed Worker from GitHub Pages (ai-kasy.online). */
  const WORKER_ORIGIN = "https://aiva.radilov-k.workers.dev";
  function apiBase() {
    const h = location.hostname;
    if (h === "localhost" || h === "127.0.0.1" || h.endsWith(".workers.dev")) return "";
    return WORKER_ORIGIN;
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
    mark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11.5 12 5l8 6.5"/><path d="M6.5 10v8.5h11V10"/><path d="M10 18.5v-4h4v4"/></svg>',
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
  };

  window.SF = { api, ApiError, esc, fmt, pct, store, toast, plural, ICON, apiBase };
})();
