// Results portal: reads only aggregates from /v1 (the server already applies k-anonymity and key scopes).
"use strict";

const DIM = {
  WL: "Натоварване", SL: "Сън и свободно време", WB: "Благополучие", TQ: "Качество на преподаването",
  TC: "Учители", SU: "Подкрепа и справедливост", CD: "Климат и дисциплина", SF: "Безопасност",
  CP: "Комуникация и партньорство", SY: "Образователна система",
};
const PILLAR = { A: "Баланс и благополучие", B: "Учене и преподаване", C: "Среда и отношения" };
const IND = {
  tutoring_regular: "Редовни частни уроци", tutoring_keep_up: "Частни уроци „за да се справи“",
  vacation_tasks: "Писмени задачи през ваканцията", behaviour_note: "Бележка за поведение",
  labelled_aggression_disputed: "„Агресия“, оспорена от родителя", recess_removed: "Отнето междучасие",
  bullying_repeated: "Повтарящ се тормоз", psychosomatic_often: "Чести главоболия или коремни болки",
};
const ASPECT = {
  respect: "Уважение", clarity: "Яснота", engagement: "Ангажиране", feedback: "Обратна връзка",
  fair_assessment: "Справедливо оценяване", climate: "Ред в часа", workload: "Подходящо натоварване",
  parent_communication: "Общуване с родителите",
};
const GROUP = { boy: "момчета", girl: "момичета", high: "оценки 4–5", low: "оценки 1–2" };
const LEVEL_NAME = { system: "Система", region: "Регион", school: "Училище", class: "Клас", teacher: "Учител" };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (x) => (x == null ? "–" : Number(x).toFixed(1).replace(".", ","));
const pct = (x) => (x == null ? "–" : Math.round(x * 100) + "%");

function key() { return $("key").value.trim(); }
async function get(path) {
  const h = key() ? { "X-API-Key": key() } : {};
  const r = await fetch(path, { headers: h });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "грешка " + r.status);
  return d;
}
function waveQ() { return $("wave").value ? "wave=" + encodeURIComponent($("wave").value) : ""; }

function tierTag(ix) {
  if (!ix || !ix.tier) return "";
  return `<span class="tier t${esc(ix.tier_code)}">${esc(ix.tier)}</span>`;
}
function bandTag(band) { return band ? `<span class="tier t${esc(band)}">${esc(band)}</span>` : ""; }
function bar(score, lo, hi, ref) {
  if (score == null) return "";
  return `<div class="bar" title="${fmt(lo)}–${fmt(hi)}">
    <div class="ci" style="left:${lo}%;width:${Math.max(1, hi - lo)}%"></div>
    ${ref != null ? `<div class="ref" style="left:${ref}%" title="средно ${fmt(ref)}"></div>` : ""}
    <div class="pt" style="left:${score}%"></div></div>`;
}

// ------------------------------------------------------------------ list
let seq = 0;   // only the latest request may render (level, wave and key can change while one is in flight)
async function loadList() {
  const my = ++seq;
  $("unit-view").hidden = true;
  $("list-view").hidden = false;
  const level = $("level").value;
  $("list-msg").textContent = "Зареждане…";
  $("list-card").hidden = true;
  try {
    const d = await get(`v1/units?level=${level}&${waveQ()}`);
    if (my !== seq) return;
    if (!d.units.length) {
      $("list-msg").textContent = level === "teacher" || level === "class"
        ? "Няма видими резултати. За това ниво е нужен ключ с подходящ достъп."
        : "Няма резултати за това ниво.";
      return;
    }
    $("list-msg").textContent = `${d.count} единици · вълна ${d.wave}`;
    $("list").innerHTML = d.units.map((u) => {
      if (u.withheld) return `<tr><td>${esc(u.unit_id)}</td><td colspan="5" class="muted small">задържан: ${esc(u.withheld)}</td></tr>`;
      const ix = u.index || {};
      const score = ix.score ?? (u.pillars || {}).B;
      const n = u.n_respondents || {};
      const rep = u.representativeness && u.representativeness !== "ok" ? ` <span class="small muted">(${esc(u.representativeness)})</span>` : "";
      return `<tr class="click" data-id="${esc(u.unit_id)}">
        <td>${esc(u.unit_id)}${rep}</td>
        <td class="num"><b>${fmt(score)}</b></td>
        <td class="hide-sm">${bar(score, ix.lo ?? score, ix.hi ?? score, ix.reference_mean)}</td>
        <td>${tierTag(ix)}</td>
        <td class="hide-sm small">${ix.rank_range ? `${ix.rank_range[0]}–${ix.rank_range[1]} от ${ix.of}` : ""}</td>
        <td class="hide-sm num small">${(n.parent || 0) + (n.student || 0)}</td></tr>`;
    }).join("");
    for (const tr of document.querySelectorAll("tr.click")) tr.addEventListener("click", () => openUnit(level, tr.dataset.id));
    $("list-card").hidden = false;
  } catch (e) {
    if (my !== seq) return;
    $("list-msg").textContent = e.message === "no computed wave" ? "Все още няма изчислени резултати." : e.message;
  }
}

// ------------------------------------------------------------------ unit
async function openUnit(level, id) {
  const my = ++seq;
  $("list-view").hidden = true;
  $("unit-view").hidden = false;
  $("unit").innerHTML = `<p class="muted">Зареждане…</p>`;
  window.scrollTo(0, 0);
  try {
    const base = `v1/units/${level}/${encodeURIComponent(id)}`;
    const [u, trend, themes, cmp] = await Promise.all([
      get(`${base}?${waveQ()}`), get(`${base}/trend`).catch(() => null), get(`${base}/themes?${waveQ()}`).catch(() => null),
      level === "system" ? null : get(`v1/compare?level=${level}&a=${encodeURIComponent(id)}&${waveQ()}`).catch(() => null),
    ]);
    if (my !== seq) return;
    $("unit").innerHTML = unitHtml(level, u, trend, themes, cmp);
  } catch (e) {
    if (my !== seq) return;
    $("unit").innerHTML = `<p class="err">${esc(e.message)}</p>`;
  }
}

function unitHtml(level, u, trend, themes, cmp) {
  if (u.withheld) return `<div class="card"><h1>${esc(u.unit_id)}</h1><p>Резултатът е задържан: ${esc(u.withheld)}</p></div>`;
  const ix = u.index;
  const n = u.n_respondents || {};
  const part = u.participation || {};
  const ref = {};
  for (const r of (cmp && cmp.rows) || []) ref[r.dimension] = r;
  let h = `<h1>${LEVEL_NAME[level]} ${esc(u.unit_id)}</h1>
    <p class="muted">Вълна ${esc(u.wave)}${u.parent_id ? " · към " + esc(u.parent_id) : ""}</p>
    <div class="card kpi">
      ${ix ? `<div><span class="small muted">Индекс</span><b>${fmt(ix.score)}</b><span class="small">${fmt(ix.lo)}–${fmt(ix.hi)}</span></div>
      <div><span class="small muted">Категория</span><b style="font-size:1rem;margin:8px 0">${tierTag(ix)}</b>${bandTag(ix.band)}</div>
      ${ix.rank_range ? `<div><span class="small muted">Място</span><b>${ix.rank_range[0]}–${ix.rank_range[1]}</b><span class="small">от ${ix.of}</span></div>` : ""}` : ""}
      <div><span class="small muted">Родители</span><b>${n.parent || 0}</b>${part.parent != null ? `<span class="small">участие ${pct(part.parent)}</span>` : ""}</div>
      <div><span class="small muted">Ученици</span><b>${n.student || 0}</b>${part.student != null ? `<span class="small">участие ${pct(part.student)}</span>` : ""}</div>
    </div>`;

  if (u.pillars) {
    h += `<h2>Стълбове</h2><div class="card"><table>${Object.entries(u.pillars).map(([p, v]) =>
      `<tr><td>${esc(PILLAR[p] || p)}</td><td class="num"><b>${fmt(v)}</b></td><td style="width:45%">${bar(v, v, v)}</td></tr>`).join("")}</table></div>`;
  }

  h += `<h2>Измерения</h2><div class="card table-wrap"><table>
    <thead><tr><th>Измерение</th><th class="num">Оценка</th><th>90% интервал · <span class="small">пунктир = средно за страната</span></th><th>Ниво</th></tr></thead><tbody>`;
  for (const [d, v] of Object.entries(u.dimensions || {})) {
    const r = ref[d];
    const sig = r && r.clear_difference ? ` <span class="small" title="ясна разлика спрямо сравнението">${r.diff > 0 ? "▲" : "▼"}</span>` : "";
    h += `<tr><td>${esc(DIM[d] || d)}</td><td class="num"><b>${fmt(v.score)}</b>${sig}</td>
      <td style="width:40%">${bar(v.score, v.lo, v.hi, r ? r.b : null)}</td><td>${bandTag(v.band)}</td></tr>`;
  }
  h += `</tbody></table></div>`;

  if (u.aspects) {
    h += `<h2>Аспекти на преподаването</h2><div class="card"><table>${Object.entries(u.aspects).map(([a, v]) =>
      `<tr><td>${esc(ASPECT[a] || a)}</td><td class="num"><b>${fmt(v.mean)}</b></td><td class="small muted num">n = ${v.n}</td></tr>`).join("")}</table>
      <p class="small muted">Поверително: виждат го само учителят и директорът.</p></div>`;
  }

  if (u.indicators && Object.keys(u.indicators).length) {
    h += `<h2>Индикатори</h2><div class="card"><table>${Object.entries(u.indicators).map(([k, v]) =>
      `<tr><td>${esc(IND[k] || k)}</td><td class="num"><b>${pct(v.share)}</b></td><td class="small muted num">от ${v.n}</td></tr>`).join("")}</table>
      <p class="small muted">Дял от отговорилите. Не влизат в индекса.</p></div>`;
  }

  const eq = (u.equity || []).filter((e) => e.flagged);
  if (u.equity && u.equity.length) {
    h += `<h2>Справедливост</h2><div class="card">`;
    h += eq.length ? `<table>${eq.map((e) => `<tr><td>${esc(DIM[e.dimension] || e.dimension)}</td>
        <td>${esc(GROUP[e.group_a] || e.group_a)} ${fmt(e.mean_a)} · ${esc(GROUP[e.group_b] || e.group_b)} ${fmt(e.mean_b)}</td>
        <td class="num"><b>${e.gap > 0 ? "+" : ""}${fmt(e.gap)}</b></td></tr>`).join("")}</table>`
      : `<p>Няма значими разлики между момчета и момичета или между силни и затрудняващи се ученици.</p>`;
    h += `<p class="small muted">Сигнал се подава при разлика над 10 точки, която не е случайна. Оценките не са сравними между училища.</p></div>`;
  }

  if (trend && trend.trend && trend.trend.length > 1) {
    h += `<h2>Промяна между вълните</h2><div class="card"><table><thead><tr><th>Вълна</th><th class="num">Индекс</th><th>Интервал</th></tr></thead>
      ${trend.trend.map((t) => `<tr><td>${esc(t.wave)}</td><td class="num"><b>${fmt(t.index && t.index.score)}</b></td>
        <td style="width:50%">${t.index ? bar(t.index.score, t.index.lo, t.index.hi) : ""}</td></tr>`).join("")}</table></div>`;
  }

  if (themes && themes.themes && Object.keys(themes.themes).length) {
    const items = Object.entries(themes.themes).sort((a, b) => b[1] - a[1]);
    h += `<h2>Теми от свободния текст</h2><div class="card"><table>${items.map(([t, c]) =>
      `<tr><td>${esc(t)}</td><td class="num"><b>${esc(c)}</b> споменавания</td></tr>`).join("")}</table>
      <p class="small muted">Само брой споменавания. Самите текстове не се публикуват.</p></div>`;
  }
  return h;
}

// ------------------------------------------------------------------ wiring
async function init() {
  try { $("key").value = sessionStorage.getItem("sf-key") || ""; } catch (e) {}
  try {
    const w = await get("v1/waves");
    $("wave").innerHTML = w.waves.slice().reverse().map((x) => `<option>${esc(x)}</option>`).join("");
  } catch (e) {}
  loadList();
}
$("level").addEventListener("change", loadList);
$("wave").addEventListener("change", loadList);
$("key").addEventListener("change", () => { try { sessionStorage.setItem("sf-key", key()); } catch (e) {} loadList(); });
$("back").addEventListener("click", loadList);
init();
