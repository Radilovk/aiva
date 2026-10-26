// Survey client: code -> /v1/session -> one page per module, branching via /v1/flow -> /v1/responses.
// Answers are option indices (0..k-1) or free text, exactly as engine.py expects.
"use strict";

const MODULES = {
  PR: "За теб", WL: "Домашни и натоварване", SL: "Сън и свободно време", WB: "Как се чувстваш",
  TQ: "Часовете", TC: "Учителите", SU: "Подкрепа", CD: "Правила и дисциплина", SF: "Безопасност",
  QC: "Проверка", CP: "Комуникация", SY: "Учебните програми", OT: "Със свои думи",
};
const $ = (id) => document.getElementById(id);
const st = { code: "", session: null, questions: [], answers: {}, page: 0, started: 0 };

async function api(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(errText(r.status, data.error));
  return data;
}
function errText(status, msg) {
  if (status === 404 && msg === "unknown code") return "Няма такъв код. Провери дали е въведен правилно.";
  if (status === 409) return "Този код вече е използван.";
  return msg || "Възникна грешка. Опитай отново.";
}
function show(id) {
  for (const s of document.querySelectorAll("main > section")) s.hidden = s.id !== id;
  window.scrollTo(0, 0);
}

// ------------------------------------------------------------------ pages = modules in flow order
function pages() {
  const out = [];
  for (const q of st.questions) {
    const last = out[out.length - 1];
    const key = q.module + (q.teacher_id ? "@" + q.teacher_id : "");
    if (last && last.key === key) last.items.push(q);
    else out.push({ key, module: q.module, teacher: q.teacher_id, items: [q] });
  }
  return out;
}

function teacherName(id) {
  const t = (st.session.teachers || []).find((x) => x.teacher_id === id);
  return t ? t.name : "";
}

// Kid scales carry their own emoji ("🙂 Никога"); split it off so it can be shown large. Never invent one:
// a face must match the item's polarity, and only the question bank knows it.
const LEAD_EMOJI = /^(\p{Extended_Pictographic}\uFE0F?)\s*/u;
function splitEmoji(text) {
  const m = String(text).match(LEAD_EMOJI);
  return m ? [m[1], text.slice(m[0].length)] : [null, text];
}

function render() {
  const ps = pages();
  st.page = Math.min(st.page, ps.length - 1);
  const p = ps[st.page];
  const form = $("q-form");
  form.innerHTML = "";
  const head = document.createElement("div");
  head.className = "modhead";
  head.textContent = (MODULES[p.module] || p.module) + (p.teacher ? " · " + teacherName(p.teacher) : "");
  form.appendChild(head);

  for (const q of p.items) {
    const box = document.createElement("div");
    box.className = "q";
    if (q.type === "notice") {
      box.innerHTML = `<div class="note"></div>`;
      box.firstChild.textContent = q.text;
      form.appendChild(box);
      continue;
    }
    const qt = document.createElement("div");
    qt.className = "qt";
    qt.textContent = q.text;
    box.appendChild(qt);
    if (q.type === "text") {
      const ta = document.createElement("textarea");
      ta.maxLength = 1500;
      ta.value = st.answers[q.id] || "";
      ta.placeholder = "Не пиши имена, телефони и имейли.";
      ta.addEventListener("input", () => { st.answers[q.id] = ta.value; save(); });
      box.appendChild(ta);
    } else {
      const opts = document.createElement("div");
      const withEmoji = (q.options || []).every((o) => splitEmoji(o)[0]);
      opts.className = "opts" + (withEmoji ? " emoji" : "");
      (q.options || []).forEach((label, i) => {
        const l = document.createElement("label");
        const inp = document.createElement("input");
        inp.type = "radio"; inp.name = q.id; inp.value = i;
        inp.checked = st.answers[q.id] === i;
        if (inp.checked) l.classList.add("on");
        inp.addEventListener("change", () => choose(q, i, opts, l));
        l.appendChild(inp);
        const [emoji, text] = splitEmoji(label);
        if (withEmoji) {
          const em = document.createElement("span");
          em.className = "em"; em.textContent = emoji;
          l.appendChild(em);
        }
        const span = document.createElement("span");
        span.textContent = withEmoji ? text : label;
        l.appendChild(span);
        opts.appendChild(l);
      });
      box.appendChild(opts);
    }
    form.appendChild(box);
  }

  $("page-label").textContent = `Част ${st.page + 1} от ${ps.length}`;
  const answered = st.questions.filter((q) => q.type !== "notice" && st.answers[q.id] !== undefined && st.answers[q.id] !== "").length;
  const total = st.questions.filter((q) => q.type !== "notice").length;
  $("count-label").textContent = `${answered} / ${total} отговора`;
  $("progress").style.width = `${Math.round((100 * st.page) / Math.max(1, ps.length - 1))}%`;
  $("prev-btn").disabled = st.page === 0;
  $("next-btn").textContent = st.page === ps.length - 1 ? "Изпрати" : "Напред";
}

let flowTimer = null;
function choose(q, i, opts, label) {
  st.answers[q.id] = i;
  for (const l of opts.children) l.classList.remove("on");
  label.classList.add("on");
  save();
  // Branching: ask the server which questions are visible now.
  clearTimeout(flowTimer);
  flowTimer = setTimeout(refreshFlow, 150);
}

async function refreshFlow() {
  try {
    const before = st.questions.map((q) => q.id).join();
    const r = await api("v1/flow", { code: st.code, answers: plainAnswers() });
    st.questions = r.questions;
    if (r.questions.map((q) => q.id).join() !== before) render();
  } catch (e) { /* keep current list; submit re-validates on the server */ }
}

function plainAnswers() {
  const out = {};
  for (const [k, v] of Object.entries(st.answers)) if (!k.includes("@")) out[k] = v;
  return out;
}

async function submit() {
  const visible = new Set(st.questions.map((q) => q.id));
  const answers = {}, teacher_answers = {};
  for (const [k, v] of Object.entries(st.answers)) {
    if (!visible.has(k) || v === "" || v === undefined) continue;   // drop answers to hidden sub-questions
    const [base, tid] = k.split("@");
    if (tid) (teacher_answers[tid] = teacher_answers[tid] || {})[base] = v;
    else answers[k] = v;
  }
  $("next-btn").disabled = true;
  $("submit-err").hidden = true;
  try {
    await api("v1/responses", { code: st.code, duration_s: Math.round((Date.now() - st.started) / 1000), answers, teacher_answers });
    try { sessionStorage.removeItem(storeKey()); } catch (e) {}
    show("step-done");
  } catch (e) {
    $("submit-err").textContent = e.message;
    $("submit-err").hidden = false;
  } finally {
    $("next-btn").disabled = false;
  }
}

// ------------------------------------------------------------------ unsent draft (this browser tab only)
function storeKey() { return "sf-draft-" + st.code; }
function save() {
  try { sessionStorage.setItem(storeKey(), JSON.stringify({ answers: st.answers, page: st.page, started: st.started })); } catch (e) {}
}
function restore() {
  try {
    const d = JSON.parse(sessionStorage.getItem(storeKey()) || "null");
    if (d) { st.answers = d.answers || {}; st.page = d.page || 0; st.started = d.started || st.started; }
  } catch (e) {}
}

// ------------------------------------------------------------------ wiring
$("code-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const code = $("code").value.trim().toUpperCase();
  $("code-err").hidden = true;
  try {
    st.session = await api("v1/session", { code });
    st.code = code;
    st.questions = st.session.questions;
    st.started = Date.now();
    restore();
    const s = st.session;
    $("intro-title").textContent = s.role === "parent" ? "Анкета за родители" : "Анкета за ученици";
    $("intro-text").textContent = s.role === "parent"
      ? `Отговаряте за детето си в ${s.grade} клас. Някои въпроси са за класния ръководител.`
      : `Ти си в ${s.grade} клас. Ще те питаме как се чувстваш в училище и за някои от учителите ти.`;
    // Children under 14: a parent unlocks the code with consent (Personal Data Protection Act).
    $("consent-box").hidden = !(s.role === "student" && s.grade <= 7);
    show("step-intro");
  } catch (e) {
    $("code-err").textContent = e.message;
    $("code-err").hidden = false;
  }
});

$("start-btn").addEventListener("click", () => {
  if (!$("consent-box").hidden && !$("consent").checked) {
    $("consent-box").style.outline = "2px solid var(--bad)";
    return;
  }
  show("step-q");
  render();
});
$("prev-btn").addEventListener("click", () => { st.page = Math.max(0, st.page - 1); save(); render(); window.scrollTo(0, 0); });
$("next-btn").addEventListener("click", () => {
  const n = pages().length;
  if (st.page >= n - 1) return submit();
  st.page += 1; save(); render(); window.scrollTo(0, 0);
});

const pre = new URLSearchParams(location.search).get("code");
if (pre) $("code").value = pre;
