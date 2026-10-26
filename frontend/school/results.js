// Results portal: reads only aggregates from /api/sf (the server applies k-anonymity and the key's scope).
"use strict";

(function () {
  const { api, esc, fmt, pct, store, toast, ICON } = window.SF;
  const $ = (id) => document.getElementById(id);
  const keyStore = store("session");

  const DIM = {
    WL: ["Натоварване", "Домашни спрямо нормата за класа, уикенд, ваканция, контролни"],
    SL: ["Сън и свободно време", "Часове сън спрямо препоръката, свободна игра, движение"],
    WB: ["Благополучие", "Оплаквания, тревожност, умора, радост от ученето"],
    TQ: ["Качество на преподаването", "Яснота, ангажиране, обратна връзка, подходяща трудност"],
    TC: ["Учители", "Уважение, яснота, справедливо оценяване, ред в часа"],
    SU: ["Подкрепа и справедливост", "Помощ при затруднение, равно отношение"],
    CD: ["Климат и дисциплина", "Ясни правила, игра не се третира като агресия, без унижение"],
    SF: ["Безопасност", "Тормоз, реакция на възрастните, чувство за сигурност"],
    CP: ["Комуникация и партньорство", "Информираност, отзивчивост, несъгласие без последици"],
    SY: ["Образователна система", "Учебни програми, учебници, НВО, разписание – извън контрола на училището"],
  };
  const PILLAR = { A: ["Баланс и благополучие", "натоварване · сън · благополучие"], B: ["Учене и преподаване", "преподаване · учители · подкрепа"], C: ["Среда и отношения", "климат · безопасност · комуникация"] };
  const IND = {
    tutoring_regular: "Редовни частни уроци", tutoring_keep_up: "Частни уроци, „за да се справи“",
    vacation_tasks: "Писмени задачи през ваканцията", behaviour_note: "Получена бележка за поведение",
    labelled_aggression_disputed: "„Агресия“, с която родителят не е съгласен", recess_removed: "Отнето междучасие като наказание",
    bullying_repeated: "Повтарящ се тормоз", psychosomatic_often: "Чести главоболия или болки в корема",
  };
  const ASPECT = {
    respect: "Уважение", clarity: "Яснота", engagement: "Интересни часове", feedback: "Обратна връзка",
    fair_assessment: "Справедливо оценяване", climate: "Ред без крясъци", workload: "Разумен обем", parent_communication: "Общуване с родителите",
  };
  const GROUP = { boy: "момчетата", girl: "момичетата", strong: "силните ученици (предимно 5 и 6)", struggling: "затрудняващите се (предимно 3 и 4 или слаби)" };
  const SHORT = { boy: "Момчета", girl: "Момичета", strong: "Силни", struggling: "Затрудняващи се" };
  const STAGE = { I: "начален етап (I–IV)", II: "прогимназия (V–VII)", III: "гимназия (VIII–XII)" };
  const TABS = [
    { level: "school", label: "Училища" }, { level: "region", label: "Региони" }, { level: "system", label: "Страната" },
    { level: "class", label: "Класове", lock: ["researcher", "school_admin", "admin"] },
    { level: "teacher", label: "Учители", lock: ["school_admin", "teacher", "admin"] },
  ];
  const TIER_FILTERS = [["", "Всички"], ["2", "Значително над"], ["1", "Над средното"], ["0", "Около"], ["-1", "Под средното"], ["-2", "Значително под"]];
  const LEVEL_WORD = { school: ["училищата", "училище"], region: ["регионите", "регион"], class: ["класовете от същия етап", "клас"], teacher: ["учителите", "учител"], system: ["", "страна"] };

  const st = { key: keyStore.get("sf-key") || "", who: { scope: "public" }, waves: [], wave: "", level: "school", q: "", tier: "", units: [], demo: false };

  // ------------------------------------------------------------------ helpers
  const clamp = (x) => Math.max(0, Math.min(100, x));
  // Interval bars use a 20–100 scale: real unit scores sit there, and 0–100 would squeeze the intervals into dots.
  const pos = (v) => (Math.max(20, Math.min(100, v)) - 20) * 1.25;
  function ci(score, lo, hi, ref, big = false) {
    if (score === null || score === undefined) return "";
    lo = lo ?? score; hi = hi ?? score;
    return `<div class="ci${big ? " big" : ""}" role="img" aria-label="${fmt(score)}, интервал ${fmt(lo)}–${fmt(hi)}${ref != null ? ", средно " + fmt(ref) : ""}">
      <div class="rng" style="left:${pos(lo)}%;width:${Math.max(1.5, pos(hi) - pos(lo))}%"></div>
      ${ref != null ? `<div class="ref" style="left:${pos(ref)}%"></div>` : ""}
      <div class="dot" style="left:${pos(score)}%"></div></div>`;
  }
  const rankText = (ix) => `${ix.rank_range[0] === ix.rank_range[1] ? ix.rank_range[0] : ix.rank_range[0] + "–" + ix.rank_range[1]} от ${ix.of}`;
  const tierBadge = (ix) => (ix && ix.tier ? `<span class="tier tier-${esc(ix.tier_code)}">${esc(ix.tier)}</span>` : "");
  const bandWord = (b) => (b ? `<span class="band-${esc(b)}">${esc(b)}</span>` : "");
  const respondents = (n) => (n ? (n.parent || 0) + (n.student || 0) : 0);
  function fill() { for (const el of document.querySelectorAll("[data-icon]")) el.innerHTML = ICON[el.dataset.icon] || ""; }

  // ------------------------------------------------------------------ access
  async function loadWho() {
    if (!st.key) { st.who = { scope: "public" }; return; }
    try { st.who = await api("/whoami", { key: st.key }); }
    catch (e) { st.key = ""; keyStore.del("sf-key"); st.who = { scope: "public" }; toast("Ключът не е валиден. Показваме публичните резултати."); }
  }
  function whoLabel() {
    const w = st.who;
    if (w.scope === "school_admin") return w.school_name || "Училище";
    if (w.scope === "teacher") return w.teacher_name || "Учител";
    if (w.scope === "researcher") return "Изследовател";
    if (w.scope === "admin") return "Оператор";
    return "Вход";
  }
  const allowed = (t) => !t.lock || t.lock.includes(st.who.scope);

  // ------------------------------------------------------------------ list
  function renderTabs() {
    $("tabs").innerHTML = TABS.map((t) => `<button class="tab" role="tab" data-level="${t.level}" aria-selected="${t.level === st.level}">
      ${t.lock && !allowed(t) ? ICON.lock : ""}${esc(t.label)}</button>`).join("");
    for (const b of $("tabs").children) {
      b.addEventListener("click", () => {
        const t = TABS.find((x) => x.level === b.dataset.level);
        if (!allowed(t)) return openLogin(`${t.label} се виждат само с ключ – ${t.level === "teacher" ? "на директора или самия учител" : "на директора или изследовател"}.`);
        if (t.level === "system") return go(`#/system/BG`);
        go(`#/${t.level}`);
      });
    }
    $("filters").innerHTML = TIER_FILTERS.map(([c, l]) => `<button type="button" data-t="${c}" aria-pressed="${st.tier === c}">${esc(l)}</button>`).join("");
    for (const b of $("filters").children) b.addEventListener("click", () => { st.tier = b.dataset.t; renderTabs(); renderUnits(); });
    $("filters").hidden = st.level === "teacher";
  }

  let seq = 0;   // only the latest request renders (tabs, wave and key can change while one is in flight)
  async function loadList() {
    const my = ++seq;
    show("v-list");
    renderTabs();
    $("units").innerHTML = Array.from({ length: 6 }, () => `<div class="skeleton" style="height:76px"></div>`).join("");
    $("list-msg").textContent = "";
    try {
      const d = await api(`/units?level=${st.level}&wave=${encodeURIComponent(st.wave)}`, { key: st.key });
      if (my !== seq) return;
      st.units = d.units;
      setDemo(d.demo);
      renderUnits();
    } catch (e) {
      if (my !== seq) return;
      $("units").innerHTML = "";
      $("list-msg").textContent = e.message;
    }
  }

  function renderUnits() {
    const q = st.q.trim().toLowerCase();
    let us = st.units.filter((u) => !q || `${u.name} ${u.parent_name || ""}`.toLowerCase().includes(q));
    if (st.tier) us = us.filter((u) => u.index?.tier_code === st.tier);
    const word = LEVEL_WORD[st.level][0];
    $("list-msg").textContent = !st.units.length
      ? (st.level === "teacher" ? "Няма резултати за учители с вашия достъп или все още няма достатъчно оценки (нужни са поне 10 ученици)." : `Няма публикувани резултати за ${word}.`)
      : us.length ? `${us.length} ${us.length === 1 ? LEVEL_WORD[st.level][1] : word} · подредени по индекс` : "Няма съвпадения.";
    $("units").innerHTML = us.map((u) => {
      if (u.withheld) return `<div class="unit withheld"><div><div class="nm">${esc(u.name || u.unit_id)}</div><div class="sub">Резултатът е задържан за проверка.</div></div></div>`;
      const teacher = st.level === "teacher";
      const ix = teacher ? u.tc : u.index;
      const sub = [u.parent_name, st.level === "class" ? STAGE[u.stage] : null].filter(Boolean).join(" · ");
      const low = u.representativeness === "low" ? `<span class="chip">ниско участие</span>` : "";
      return `<a class="unit" href="#/${st.level}/${encodeURIComponent(u.unit_id)}">
        <div><div class="nm">${esc(u.name)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ""}</div>
        ${ci(ix?.score, ix?.lo, ix?.hi, teacher ? null : ix?.reference_mean)}
        <div class="score num">${fmt(ix?.score)}<small>${teacher ? "учители" : "индекс"}</small></div>
        <div class="meta">${teacher ? "" : tierBadge(ix)}${ix?.rank_range ? `<span class="rank">място ${rankText(ix)}</span>` : ""}
          <span>${respondents(u.n_respondents)} отг.</span>${low}</div></a>`;
    }).join("");
  }

  // ------------------------------------------------------------------ unit page
  async function loadUnit(level, id) {
    const my = ++seq;
    show("v-unit");
    $("unit").innerHTML = `<div class="skeleton" style="height:42px;width:60%"></div><div class="skeleton" style="height:120px;margin-top:20px"></div><div class="skeleton" style="height:320px;margin-top:20px"></div>`;
    const w = encodeURIComponent(st.wave);
    const base = `/units/${level}/${encodeURIComponent(id)}`;
    try {
      const [u, trend, themes, cmp] = await Promise.all([
        api(`${base}?wave=${w}`, { key: st.key }),
        api(`${base}/trend?wave=${w}`, { key: st.key }).catch(() => null),
        api(`${base}/themes?wave=${w}`, { key: st.key }).catch(() => null),
        level === "system" ? null : api(`/compare?level=${level}&a=${encodeURIComponent(id)}&wave=${w}`, { key: st.key }).catch(() => null),
      ]);
      if (my !== seq) return;
      setDemo(u.demo);
      document.title = `${u.name} · Глас за училището`;
      $("unit").innerHTML = unitHtml(level, u, trend, themes, cmp);
      window.scrollTo(0, 0);
    } catch (e) {
      if (my !== seq) return;
      $("unit").innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
    }
  }

  function heroSentence(level, u) {
    const ix = u.index;
    if (!ix) return "";
    const parts = [`Индексът е <b>${fmt(ix.score)}</b> – вероятно между ${fmt(ix.lo)} и ${fmt(ix.hi)}.`];
    if (ix.tier && ix.tier_code !== "na" && level !== "system") {
      const word = LEVEL_WORD[level][0];
      const t = { 2: "значително над средното", 1: "над средното", 0: "около средното", "-1": "под средното", "-2": "значително под средното" }[ix.tier_code];
      parts.push(`Това е <b>${t}</b> за ${word} (${fmt(ix.reference_mean)}).`);
    } else if (ix.tier_code === "na") {
      parts.push("Отговорите са твърде малко за сигурно сравнение.");
    }
    if (ix.band) parts.push(`Спрямо нормите нивото е ${bandWord(ix.band).toLowerCase()}.`);
    return parts.join(" ");
  }

  function unitHtml(level, u, trend, themes, cmp) {
    if (u.withheld) return `<h1>${esc(u.name)}</h1><div class="note warn">Резултатът е задържан: отговорите са повече от учениците в класа и се проверяват от човек.</div>`;
    const ix = u.index;
    const n = u.n_respondents || {};
    const part = u.participation || {};
    const ref = {};
    for (const r of cmp?.rows || []) ref[r.dimension] = r;
    const sub = [u.parent_name && level !== "region" ? u.parent_name : null, u.stage && level !== "system" ? STAGE[u.stage] : null].filter(Boolean).join(" · ");
    let h = `<div class="hero"><div><h1>${esc(u.name)}</h1><div class="sub">${esc(sub)}${sub ? " · " : ""}${esc(waveTitle())}</div>
      ${ix ? `<p class="hero-says" style="margin-top:14px">${heroSentence(level, u)}</p>` : ""}</div>
      <div class="hero-score">${ix ? `<div class="big-num">${fmt(ix.score)}<small>индекс от 100</small></div><div class="stack">${tierBadge(ix)}
        ${ix.rank_range ? `<div class="small muted">място ${rankText(ix)}</div>` : ""}</div>`
        : level === "teacher" && u.dimensions?.TC ? `<div class="big-num">${fmt(u.dimensions.TC.score)}<small>оценка от учениците и родителите</small></div>` : ""}</div></div>`;
    if (ix) h += `<div style="margin-top:16px">${ci(ix.score, ix.lo, ix.hi, ix.reference_mean, true)}</div>`;

    h += `<div class="kpis">
      <div class="kpi"><span>Родители</span><b>${n.parent || 0}</b>${part.parent != null ? `<em>участие ${pct(part.parent)}</em>` : ""}</div>
      <div class="kpi"><span>Ученици</span><b>${n.student || 0}</b>${part.student != null ? `<em>участие ${pct(part.student)}</em>` : ""}</div>
      ${u.representativeness === "low" ? `<div class="kpi"><span>Внимание</span><b style="font-size:1rem">Ниско участие</b><em>под 30% – недоволните отговарят по-често</em></div>` : ""}
    </div>`;
    if (level === "teacher") h += `<div class="note" style="margin-top:18px"><div class="priv">${ICON.lock}<span>Поверително. Този резултат виждат само учителят и директорът. Не се публикува.</span></div></div>`;

    if (u.pillars && Object.keys(u.pillars).length && level !== "teacher") {
      h += `<h2>Три стълба</h2><div class="pillars">${Object.entries(u.pillars).map(([p, v]) => `<div class="pillar"><div class="pn">${esc(PILLAR[p][0])}</div>
        <div class="pv">${fmt(v)}</div><div class="meter"><i style="width:${clamp(v)}%"></i></div><div class="pd" style="margin-top:8px">${esc(PILLAR[p][1])}</div></div>`).join("")}</div>`;
    }

    const dims = Object.entries(u.dimensions || {});
    if (dims.length) {
      h += `<h2>${level === "teacher" ? "Оценка" : "Десетте измерения"}</h2><div class="card">
        <div class="legend"><span><i class="l-dot"></i>оценка</span><span><i class="l-rng"></i>90% интервал</span>${level !== "system" ? `<span><i class="l-ref"></i>средно за страната</span>` : ""}<span>скала 20–100</span></div>
        <div class="dims">${dims.map(([d, v]) => {
          const r = ref[d];
          const flag = r && r.clear_difference ? `<span class="flag ${r.diff > 0 ? "up" : "down"}">${r.diff > 0 ? "▲ ясно над" : "▼ ясно под"} средното</span>` : "";
          return `<div class="dim"><div class="dn">${esc(DIM[d]?.[0] || d)}${flag ? `<br>${flag}` : ""}<small>${esc(DIM[d]?.[1] || "")}</small></div>
            ${ci(v.score, v.lo, v.hi, r ? r.b : null)}<div class="dv">${fmt(v.score)}<small>${bandWord(v.band)}</small></div></div>`;
        }).join("")}</div>
        <p class="section-note">Нива спрямо нормите: 80+ добро · 60–79 приемливо · 40–59 тревожно · под 40 критично.</p></div>`;
    }

    if (u.aspects && Object.keys(u.aspects).length) {
      h += `<h2>Аспекти</h2><div class="card">${Object.entries(u.aspects).map(([a, v]) => `<div class="ind"><span>${esc(ASPECT[a] || a)}</span><b>${fmt(v.mean)}</b>
        <div class="meter"><i style="width:${clamp(v.mean)}%"></i></div></div>`).join("")}<p class="section-note">Показват се аспекти с поне 10 оценки.</p></div>`;
    }

    if (u.indicators && Object.keys(u.indicators).length) {
      h += `<h2>Колко често се случва</h2><div class="card">${Object.entries(u.indicators).map(([k, v]) => `<div class="ind"><span>${esc(IND[k] || k)} <span class="muted small">· от ${v.n}</span></span><b>${pct(v.share)}</b>
        <div class="meter"><i style="width:${clamp(v.share * 100)}%"></i></div></div>`).join("")}<p class="section-note">Дял от отговорилите. Тези показатели не влизат в индекса.</p></div>`;
    }

    if (u.equity && u.equity.length) {
      const fl = u.equity.filter((e) => e.flagged);
      const splits = [...new Set(fl.map((e) => e.split))];
      h += `<h2>Справедливост</h2><div class="card">${fl.length ? splits.map((sp) => {
          const rows = fl.filter((e) => e.split === sp);
          const a = rows[0].group_a, b = rows[0].group_b;
          return `<p style="margin:0 0 8px"><b>${esc(GROUP[a][0].toUpperCase() + GROUP[a].slice(1))}</b> и <b>${esc(GROUP[b])}</b> оценяват различно ${rows.length === 1 ? "едно измерение" : rows.length + " измерения"}:</p>
            <div class="table-wrap"><table class="t"><thead><tr><th>Измерение</th><th class="num">${esc(SHORT[a])}</th><th class="num">${esc(SHORT[b])}</th><th class="num">Разлика</th></tr></thead><tbody>
            ${rows.map((e) => `<tr><td>${esc(DIM[e.dimension]?.[0] || e.dimension)}</td><td class="num">${fmt(e.mean_a)}</td><td class="num">${fmt(e.mean_b)}</td>
              <td class="num"><b class="${e.gap > 0 ? "up" : "down"}">${e.gap > 0 ? "+" : "−"}${fmt(Math.abs(e.gap))}</b></td></tr>`).join("")}</tbody></table></div>`;
        }).join('<div style="height:18px"></div>')
        : `<p style="margin:0">Няма значими разлики между момчета и момичета, нито между силни и затрудняващи се ученици.</p>`}
        <p class="section-note">Сигнал при разлика над 10 точки, която не е случайна. Оценките на децата не са сравними между училища – тук са само за справедливост вътре в училището.</p></div>`;
    }

    if (trend && trend.trend && trend.trend.length > 1) h += `<h2>Промяна във времето</h2><div class="card trend">${trendSvg(trend.trend)}</div>`;

    if (themes && themes.themes && Object.keys(themes.themes).length) {
      const items = Object.entries(themes.themes);
      const max = Math.max(...items.map(([, c]) => c));
      h += `<h2>За какво пишат</h2><div class="card themes">${items.map(([t, c]) => `<div class="ind"><span>${esc(t)}</span><b>${c}</b>
        <div class="meter"><i style="width:${(100 * c) / max}%"></i></div></div>`).join("")}
        <p class="section-note">Брой хора, споменали темата в свободните отговори (от ${themes.respondents_with_text}). Самите текстове не се публикуват.</p></div>`;
    }
    return h;
  }

  function trendSvg(pts) {
    const W = Math.round(Math.min(720, Math.max(320, window.innerWidth - 72))), H = 190, P = { l: 30, r: 24, t: 22, b: 30 };
    const xs = pts.map((_, i) => P.l + (i * (W - P.l - P.r)) / Math.max(1, pts.length - 1));
    const vals = pts.flatMap((p) => [p.index?.lo, p.index?.hi, p.index?.score]).filter((v) => v != null);
    const lo = Math.max(0, Math.floor(Math.min(...vals) / 10) * 10 - 5), hi = Math.min(100, Math.ceil(Math.max(...vals) / 10) * 10 + 5);
    const y = (v) => P.t + ((hi - v) * (H - P.t - P.b)) / (hi - lo);
    const ok = pts.map((p, i) => [p, xs[i]]).filter(([p]) => p.index);
    const band = ok.map(([p, x]) => `${x},${y(p.index.hi ?? p.index.score)}`).concat(ok.slice().reverse().map(([p, x]) => `${x},${y(p.index.lo ?? p.index.score)}`)).join(" ");
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Индекс по вълни">
      ${[lo, (lo + hi) / 2, hi].map((v) => `<line class="axis" x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}"/><text x="4" y="${y(v) + 4}">${Math.round(v)}</text>`).join("")}
      <polygon class="band" points="${band}"/>
      <polyline class="line" points="${ok.map(([p, x]) => `${x},${y(p.index.score)}`).join(" ")}"/>
      ${ok.map(([p, x]) => `<circle class="pt" cx="${x}" cy="${y(p.index.score)}" r="5"/><text class="v" x="${x}" y="${y(p.index.score) - 10}" text-anchor="middle">${fmt(p.index.score)}</text>`).join("")}
      ${pts.map((p, i) => `<text x="${xs[i]}" y="${H - 8}" text-anchor="${i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle"}">${esc(p.title || p.wave)}</text>`).join("")}
    </svg>`;
  }

  // ------------------------------------------------------------------ shell
  function show(id) { for (const s of ["v-list", "v-unit"]) $(s).hidden = s !== id; }
  function setDemo(d) { st.demo = !!d; $("demo-banner").hidden = !d; }
  const waveTitle = () => st.waves.find((w) => w.id === st.wave)?.title || st.wave;
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

  function route() {
    const [, level, id] = (location.hash.match(/^#\/([a-z]+)(?:\/(.+))?$/) || []);
    if (level && id) return loadUnit(level, decodeURIComponent(id));
    st.level = TABS.some((t) => t.level === level && level !== "system") ? level : st.who.scope === "teacher" ? "teacher" : "school";
    document.title = "Резултати · Глас за училището";
    loadList();
  }

  function openLogin(reason) {
    $("login-err").hidden = !reason;
    if (reason) { $("login-err").textContent = reason; $("login-err").className = "note small"; }
    $("logout").hidden = !st.key;
    $("key").value = "";
    $("login-dlg").showModal();
    setTimeout(() => $("key").focus(), 30);
  }

  async function init() {
    fill();
    await loadWho();
    $("login-label").textContent = whoLabel();
    try {
      const w = await api("/waves");
      st.waves = w.waves;
      const real = w.waves.filter((x) => !x.demo);
      const def = (real.length ? real : w.waves).at(-1);
      st.wave = def?.id || "";
      $("wave").innerHTML = w.waves.slice().reverse().map((x) => `<option value="${esc(x.id)}">${esc(x.title)}</option>`).join("");
      $("wave").value = st.wave;
      if (!w.waves.length) {
        $("units").innerHTML = `<div class="card"><h3>Все още няма резултати</h3><p class="ink2" style="margin:0">Първата вълна на анкетата е в ход. Резултатите се публикуват, когато се съберат достатъчно отговори.</p></div>`;
        renderTabs();
        return;
      }
    } catch (e) {
      $("list-msg").textContent = e.message;
      return;
    }
    route();
  }

  window.addEventListener("hashchange", route);
  $("wave").addEventListener("change", () => { st.wave = $("wave").value; route(); });
  $("q").addEventListener("input", () => { st.q = $("q").value; renderUnits(); });
  $("back").addEventListener("click", () => go(`#/${st.level}`));
  $("login-btn").addEventListener("click", () => openLogin(""));
  $("login-form").addEventListener("submit", async (e) => {
    if (e.submitter?.value !== "ok") return;
    e.preventDefault();
    const k = $("key").value.trim();
    if (!k) return;
    try {
      st.who = await api("/whoami", { key: k });
      st.key = k;
      keyStore.set("sf-key", k);
      $("login-dlg").close();
      $("login-label").textContent = whoLabel();
      toast(`Влязохте като: ${whoLabel()}`);
      if (st.who.scope === "teacher") go("#/teacher"); else route();
    } catch (err) {
      $("login-err").className = "err";
      $("login-err").textContent = "Ключът не е валиден.";
      $("login-err").hidden = false;
    }
  });
  $("logout").addEventListener("click", () => {
    st.key = ""; keyStore.del("sf-key"); st.who = { scope: "public" };
    $("login-dlg").close(); $("login-label").textContent = whoLabel();
    go("#/school");
  });
  init();
})();
