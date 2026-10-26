// Survey client: code -> /session -> one question per screen -> /responses.
// Answers are option indices (0..k-1), arrays of indices (multi) or free text – exactly what engine.ts expects.
"use strict";

(function () {
  const { api, esc, store, toast, ICON } = window.SF;
  const $ = (id) => document.getElementById(id);
  const draftStore = store("session");   // this tab only: a shared family device must not keep a child's answers

  const SECTIONS = {
    PR: ["За детето", "За теб"], WL: ["Домашни и натоварване"], SL: ["Сън и свободно време"],
    WB: ["Как се чувства детето", "Как се чувстваш"], TQ: ["Часовете"], TC: ["Учителите"], SU: ["Подкрепа"],
    CD: ["Правила и дисциплина"], SF: ["Безопасност"], QC: ["Проверка"], CP: ["Връзка с училището"],
    SY: ["Учебната система"], OT: ["Със свои думи"],
  };
  // Answers that mean "no answer"; shown apart, smaller, so they never get picked by accident.
  const ALT = /^(не знам|не помня|предпочитам да не посоча|не искам да кажа)/i;
  const SECONDS = { single: 6, multi: 10, text: 30, notice: 4 };   // measured tap-through pace, not reading-every-word pace

  const st = { code: "", s: null, qs: [], answers: {}, idx: 0, started: 0, triggers: new Set(), dir: 1, busy: false };

  // ------------------------------------------------------------------ wording
  /** Students see grammatical gender that matches their answer to PR01 ("напрегнат/а" -> "напрегната"). */
  function adapt(text) {
    if (!text) return text;
    if (st.s.role !== "student") return text;
    const g = st.answers.PR01;               // 0 boy, 1 girl, otherwise keep both forms
    if (g !== 0 && g !== 1) return text.replace(/(\p{L}+)\(а\)/gu, "$1/а");
    return text
      .replace(/(\p{L}+)\/(\p{L}+)/gu, (m, a, b) => {
        if (b === "а") return g === 1 ? a + "а" : a;                       // напрегнат/а
        if (b.toLowerCase().slice(0, 2) === a.toLowerCase().slice(0, 2)) return g === 1 ? keepCase(a, b) : a;  // тревожен/тревожна
        return m;                                                           // НВО / матурите – not a gender pair
      })
      .replace(/(\p{L}+)\(а\)/gu, (m, a) => (g === 1 ? a + "а" : a));      // казвал(а)
  }
  const keepCase = (a, b) => (a[0] === a[0].toUpperCase() ? b[0].toUpperCase() + b.slice(1) : b);

  function optionText(q, text) {
    if (text === "Не сме / не съм казвал(а)") return st.s.role === "parent" ? "Не сме сигнализирали" : adapt("Не съм казвал(а)");
    return adapt(text);
  }

  function section(q) {
    const s = SECTIONS[q.module] || [q.module];
    return st.s.role === "student" && s[1] ? s[1] : s[0];
  }

  // ------------------------------------------------------------------ screens
  function show(id) {
    for (const s of document.querySelectorAll("main > section")) s.hidden = s.id !== id;
    window.scrollTo(0, 0);
  }

  function setupCodeScreen() {
    $("brand-mark").innerHTML = ICON.mark;
    $("trust").innerHTML = [
      [ICON.shield, "Анонимно. Не питаме за имена, имейли или телефони. Кодът показва само класа и дали попълва родител или ученик."],
      [ICON.chart, "Резултатите се публикуват само обобщено, когато в клас има поне 5 отговора."],
      [ICON.clock, "Можете да пропускате въпроси и да се връщате назад."],
    ].map(([i, t]) => `<div>${i}<span>${esc(t)}</span></div>`).join("");
    $("demo-grade").innerHTML = Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}"${i === 5 ? " selected" : ""}>${i + 1} клас</option>`).join("");

    const input = $("code");
    input.addEventListener("input", () => {
      const raw = input.value.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 13);
      const parts = raw.startsWith("DEMO") ? [raw] : raw.match(/.{1,4}/g) || [];
      const pos = input.selectionStart === input.value.length;
      input.value = parts.join("-");
      if (pos) input.setSelectionRange(input.value.length, input.value.length);
      $("code-err").hidden = true;
    });
    $("code-form").addEventListener("submit", (e) => { e.preventDefault(); start(input.value); });
    $("demo-role").addEventListener("change", syncDemoGrades);
    $("demo-btn").addEventListener("click", async () => {
      const btn = $("demo-btn");
      btn.disabled = true;
      try {
        const r = await api("/demo-session", { method: "POST", body: { role: $("demo-role").value, grade: Number($("demo-grade").value) } });
        await start(r.code);
      } catch (e) { showErr("code-err", e.message); }
      btn.disabled = false;
    });
    syncDemoGrades();
  }

  function syncDemoGrades() {
    const student = $("demo-role").value === "student";
    for (const o of $("demo-grade").options) o.disabled = student && Number(o.value) < 4;
    if (student && Number($("demo-grade").value) < 4) $("demo-grade").value = "4";
  }

  function showErr(id, msg) { const el = $(id); el.textContent = msg; el.hidden = false; }

  async function start(code) {
    code = String(code || "").trim();
    if (code.replace(/[^0-9A-Za-z]/g, "").length < 8) return showErr("code-err", "Кодът има 12 знака, например K7QM-2FHD-9XTA.");
    const btn = $("code-btn");
    btn.disabled = true;
    btn.textContent = "Проверяваме…";
    try {
      const s = await api("/session", { method: "POST", body: { code } });
      st.s = s;
      st.code = code;
      st.qs = s.questions;
      st.triggers = new Set(s.triggers || []);
      const d = draftStore.get(draftKey());
      st.answers = d?.answers || {};
      st.idx = d?.idx || 0;
      st.started = d?.started || Date.now();
      $("demo-flag").hidden = !s.demo;
      if (d) {
        // re-run branching for the restored answers, then resume where they left off
        await refreshFlow();
        st.idx = Math.min(st.idx, st.qs.length - 1);
        enterQuestions(true);
        toast("Продължавате оттам, където спряхте.");
      } else {
        renderIntro();
        show("s-intro");
      }
    } catch (e) {
      showErr("code-err", e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Започни";
    }
  }

  function renderIntro() {
    const s = st.s;
    const young = s.young_form;
    const min = Math.max(2, Math.round(estimateSeconds(st.qs) / 60));
    $("intro-title").textContent = s.role === "parent" ? "Анкета за родители" : young ? "Здравей! Няколко бързи въпроса" : "Здравей!";
    const meta = [s.school_name, s.class_name || `${s.grade} клас`].filter(Boolean);
    $("intro-meta").innerHTML = meta.map((m) => `<span class="chip">${esc(m)}</span>`).join("");
    const others = s.teachers.filter((t) => !t.is_class_teacher).length;
    const items = [
      [ICON.clock, `Около ${min} минути. Повечето въпроси са с едно докосване.`],
      [ICON.shield, s.role === "parent"
        ? "Отговаряте анонимно. Мислете за последния месец от учебната година."
        : "Никой няма да види отговорите ти – нито учителите, нито родителите ти. Мисли за последния месец."],
      [ICON.check, s.role === "parent"
        ? "Няма верни и грешни отговори. Ако не знаете – пропуснете въпроса или изберете „Не знам“."
        : "Няма верни и грешни отговори. Ако не искаш да отговориш на нещо – просто го пропусни."],
    ];
    if (s.teachers.length) {
      items.push([ICON.heart, s.role === "parent"
        ? "Няколко въпроса са за класния ръководител."
        : others ? `Ще те питаме и за ${others + 1} от учителите ти. Избрани са случайно, за да е честно към всички.`
          : "Няколко въпроса са за класния ти ръководител."]);
    }
    $("intro-list").innerHTML = items.map(([i, t]) => `<li>${i}<span>${esc(t)}</span></li>`).join("");
    // Children under 14: a parent unlocks the code with consent (Personal Data Protection Act).
    $("consent-box").hidden = !(s.role === "student" && s.grade <= 7);
    $("start-icon").innerHTML = ICON.next;
  }

  // ------------------------------------------------------------------ question flow
  function enterQuestions(resume) {
    show("s-q");
    if (!resume || !history.state?.sf) history.pushState({ sf: true }, "");
    render();
  }

  window.addEventListener("popstate", () => {
    if ($("s-q").hidden) return;
    history.pushState({ sf: true }, "");   // stay on the page: the phone's back button means "previous question"
    goBack();
  });

  function estimateSeconds(qs) {
    const per = st.s?.young_form ? 0.8 : 1;
    return qs.reduce((t, q) => t + (SECONDS[q.type] || 8) * per, 0);
  }

  function render() {
    const q = st.qs[st.idx];
    if (!q) return review();
    const total = st.qs.length;
    $("sec").textContent = section(q);
    $("prog").firstElementChild.style.width = `${Math.round((100 * st.idx) / total)}%`;
    $("prog").setAttribute("aria-valuenow", String(Math.round((100 * st.idx) / total)));
    const left = Math.ceil(estimateSeconds(st.qs.slice(st.idx)) / 60);
    $("left").textContent = left <= 1 ? "< 1 мин" : `≈ ${left} мин`;
    $("back-btn").innerHTML = ICON.back;

    const stage = $("stage");
    stage.innerHTML = "";
    const box = document.createElement("div");
    box.className = "sv-q" + (st.dir < 0 ? " back" : "");
    if (q.teacher_id) box.appendChild(teacherChip(q.teacher_id));

    if (q.type === "notice") {
      box.innerHTML += `<div class="support">${ICON.heart}<p style="margin:10px 0 0;font-size:1.1rem">${esc(adapt(q.text))}</p>
        <a class="big" href="tel:116111">${ICON.phone}116 111</a><p class="small muted" style="margin:6px 0 0">Безплатно, денонощно, анонимно.</p></div>
        <div class="q-actions"><button class="btn" data-act="next">Продължи</button></div>`;
    } else {
      const h = document.createElement("p");
      h.className = "q-text";
      h.id = "q-text";
      h.textContent = adapt(q.text);
      box.appendChild(h);
      if (q.type === "single") box.appendChild(singleOptions(q));
      else if (q.type === "multi") box.appendChild(multiOptions(q));
      else if (q.type === "text") box.appendChild(textInput(q));
    }
    stage.appendChild(box);
    const nb = box.querySelector('[data-act="next"]');
    if (nb) nb.addEventListener("click", next);
    const sk = box.querySelector('[data-act="skip"]');
    if (sk) sk.addEventListener("click", skip);
    // focus: the question for screen readers, the text box when typing is expected
    const ta = box.querySelector("textarea");
    if (ta && matchMedia("(hover: hover)").matches) ta.focus({ preventScroll: true });
    else (box.querySelector('.opt[aria-checked="true"]') || box.querySelector(".opt") || box).focus?.({ preventScroll: true });
  }

  function teacherChip(tid) {
    const t = st.s.teachers.find((x) => x.teacher_id === tid) || {};
    const name = t.name || "Учител";
    const initials = name.replace(/^(г-жа|г-н)\s+/i, "").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    const role = t.is_class_teacher ? "класен ръководител" : t.subject || "";
    const el = document.createElement("div");
    el.className = "who";
    el.innerHTML = `<span class="av" aria-hidden="true">${esc(initials)}</span><span>${esc(name)}${role ? " · " + esc(role) : ""}</span>`;
    return el;
  }

  function optButton(q, i, label, { multi = false, alt = false, face = null, key = null } = {}) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "opt" + (multi ? " multi" : "") + (alt ? " alt" : "") + (face ? " face" : "");
    b.setAttribute("role", multi ? "checkbox" : "radio");
    const val = st.answers[q.id];
    const on = multi ? Array.isArray(val) && val.includes(i) : val === i;
    b.setAttribute("aria-checked", String(on));
    b.dataset.i = String(i);
    b.innerHTML = face
      ? `<span class="emo" aria-hidden="true">${face}</span><span class="lbl">${esc(label)}</span>`
      : `<span class="mark">${ICON.check}</span><span class="lbl">${esc(label)}</span>${key ? `<kbd>${key}</kbd>` : ""}`;
    return b;
  }

  function splitEmoji(text) {
    const m = /^(\p{Extended_Pictographic}️?)\s*/u.exec(text);
    return m ? [m[1], text.slice(m[0].length)] : [null, text];
  }

  function singleOptions(q) {
    const wrap = document.createElement("div");
    const opts = q.options || [];
    const faces = opts.length && opts.every((o) => splitEmoji(o)[0]);
    const main = document.createElement("div");
    main.className = "opts" + (faces ? " faces" : "");
    main.setAttribute("role", "radiogroup");
    main.setAttribute("aria-labelledby", "q-text");
    const alt = document.createElement("div");
    alt.className = "opts-alt";
    let k = 0;
    const order = opts.map((o, i) => [o, i]).sort((a, b) => (ALT.test(a[0]) && !faces) - (ALT.test(b[0]) && !faces));
    for (const [o, i] of order) {
      const isAlt = !faces && ALT.test(o);
      const [emo, txt] = faces ? splitEmoji(o) : [null, o];
      const b = optButton(q, i, optionText(q, txt), { alt: isAlt, face: emo, key: ++k <= 9 ? String(k) : null });
      b.addEventListener("click", () => choose(q, i, wrap));
      (isAlt ? alt : main).appendChild(b);
    }
    wrap.appendChild(main);
    if (alt.children.length) wrap.appendChild(alt);
    wrap.appendChild(actions(q, false));
    return wrap;
  }

  function multiOptions(q) {
    const wrap = document.createElement("div");
    const hint = document.createElement("p");
    hint.className = "q-hint";
    hint.textContent = st.s.role === "student" ? "Можеш да избереш повече от едно." : "Може да изберете повече от едно.";
    wrap.appendChild(hint);
    const main = document.createElement("div");
    main.className = "opts";
    (q.options || []).forEach((o, i) => {
      const b = optButton(q, i, optionText(q, o), { multi: true, key: i < 9 ? String(i + 1) : null });
      b.addEventListener("click", () => {
        const cur = new Set(Array.isArray(st.answers[q.id]) ? st.answers[q.id] : []);
        cur.has(i) ? cur.delete(i) : cur.add(i);
        if (cur.size) st.answers[q.id] = [...cur].sort((a, c) => a - c); else delete st.answers[q.id];
        b.setAttribute("aria-checked", String(cur.has(i)));
        syncNext(wrap, q);
        save();
      });
      main.appendChild(b);
    });
    wrap.appendChild(main);
    wrap.appendChild(actions(q, true));
    return wrap;
  }

  function textInput(q) {
    const wrap = document.createElement("div");
    const ta = document.createElement("textarea");
    ta.maxLength = 1500;
    ta.setAttribute("aria-labelledby", "q-text");
    ta.value = typeof st.answers[q.id] === "string" ? st.answers[q.id] : "";
    ta.placeholder = st.s.role === "student" ? "Пиши свободно. Без имена, за да остане анонимно." : "Пишете свободно. Моля, без имена на деца и учители.";
    const counter = document.createElement("div");
    counter.className = "counter";
    const upd = () => { counter.textContent = ta.value.length ? `${ta.value.length} / 1500` : "По желание"; };
    ta.addEventListener("input", () => {
      if (ta.value.trim()) st.answers[q.id] = ta.value; else delete st.answers[q.id];
      upd(); syncNext(wrap, q); save();
    });
    upd();
    wrap.appendChild(ta);
    wrap.appendChild(counter);
    wrap.appendChild(actions(q, true));
    return wrap;
  }

  function actions(q, withNext) {
    const a = document.createElement("div");
    a.className = "q-actions";
    if (withNext) a.innerHTML = `<button class="btn" data-act="next">${answered(q) ? "Напред" : "Пропусни"} ${ICON.next}</button>`;
    else if (!answered(q)) a.innerHTML = `<button class="link-btn" data-act="skip">Пропусни въпроса</button>`;
    else a.innerHTML = `<button class="btn secondary small" data-act="next">Напред ${ICON.next}</button>`;
    if (st.idx < 3 && q.type !== "text") {
      const frag = document.createDocumentFragment();
      const kh = document.createElement("div");
      kh.className = "kbd-help";
      kh.innerHTML = "Клавиши: <kbd>1</kbd>–<kbd>9</kbd> избор · <kbd>Enter</kbd> напред · <kbd>←</kbd> назад";
      frag.append(a, kh);
      return frag;
    }
    return a;
  }

  function syncNext(wrap, q) {
    const b = wrap.querySelector('[data-act="next"]');
    if (b) b.innerHTML = `${answered(q) ? "Напред" : "Пропусни"} ${ICON.next}`;
  }

  function answered(q) {
    const v = st.answers[q.id];
    return v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length);
  }

  let advanceTimer = null;
  async function choose(q, i, wrap) {
    if (st.busy) return;
    st.answers[q.id] = i;
    for (const b of wrap.querySelectorAll(".opt")) b.setAttribute("aria-checked", String(Number(b.dataset.i) === i));
    save();
    clearTimeout(advanceTimer);
    const wait = new Promise((r) => { advanceTimer = setTimeout(r, 260); });   // let the tap register visually
    if (st.triggers.has(q.id)) {
      st.busy = true;
      try { await Promise.all([refreshFlow(), wait]); } finally { st.busy = false; }
    } else {
      await wait;
    }
    if (st.qs[st.idx]?.id === q.id) next();
  }

  async function refreshFlow() {
    const cur = st.qs[st.idx]?.id;
    try {
      const r = await api("/flow", { method: "POST", body: { code: st.code, answers: plainAnswers() } });
      st.qs = r.questions;
      const j = st.qs.findIndex((x) => x.id === cur);
      if (j >= 0) st.idx = j;
    } catch (e) {
      toast(e.message);
    }
  }

  function plainAnswers() {
    const out = {};
    for (const [k, v] of Object.entries(st.answers)) if (!k.includes("@")) out[k] = v;
    return out;
  }

  function next() {
    st.dir = 1;
    st.idx += 1;
    save();
    if (st.idx >= st.qs.length) return review();
    render();
  }
  function skip() { delete st.answers[st.qs[st.idx].id]; save(); next(); }
  function goBack() {
    if (!$("s-review").hidden) { st.idx = st.qs.length - 1; show("s-q"); st.dir = -1; return render(); }
    if (st.idx === 0) { renderIntro(); return show("s-intro"); }
    st.dir = -1;
    st.idx -= 1;
    save();
    render();
  }

  document.addEventListener("keydown", (e) => {
    if ($("s-q").hidden || e.metaKey || e.ctrlKey || e.altKey) return;
    const typing = e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement;
    const q = st.qs[st.idx];
    if (!q) return;
    if (!typing && /^[1-9]$/.test(e.key)) {
      const b = $("stage").querySelectorAll(".opt")[Number(e.key) - 1];
      if (b) { e.preventDefault(); b.click(); }
    } else if (e.key === "Enter" && !(typing && e.target instanceof HTMLTextAreaElement && !e.ctrlKey)) {
      if (q.type !== "single" || answered(q)) { e.preventDefault(); next(); }
    } else if (!typing && (e.key === "ArrowLeft" || e.key === "Backspace")) {
      e.preventDefault(); goBack();
    } else if (!typing && e.key === "ArrowRight" && (answered(q) || q.type === "notice")) {
      e.preventDefault(); next();
    }
  });

  // ------------------------------------------------------------------ review + submit
  function review() {
    const real = st.qs.filter((q) => q.type !== "notice");
    const done = real.filter(answered);
    const skipped = real.map((q, i) => [q, i]).filter(([q]) => !answered(q) && q.type !== "text");
    $("review-stats").innerHTML = `<div><b>${done.length}</b><span>отговора</span></div>` +
      (skipped.length ? `<div><b>${skipped.length}</b><span>пропуснати</span></div>` : "");
    $("review-skipped").innerHTML = skipped.length
      ? `<p class="ink2">${st.s.role === "student" ? "Пропуснатите въпроси не са проблем. Ако искаш, можеш да се върнеш към тях:" : "Пропуснатите въпроси не са проблем. Ако желаете, можете да се върнете към тях:"}</p>
         <ul class="skipped">${skipped.slice(0, 8).map(([q]) => `<li><button data-id="${esc(q.id)}">${esc(adapt(q.text))}</button></li>`).join("")}</ul>`
      : `<p class="ink2">${st.s.role === "student" ? "Отговори на всичко – благодарим!" : "Отговорихте на всички въпроси – благодарим!"}</p>`;
    for (const b of $("review-skipped").querySelectorAll("button[data-id]")) {
      b.addEventListener("click", () => { st.idx = st.qs.findIndex((q) => q.id === b.dataset.id); st.dir = -1; show("s-q"); render(); });
    }
    show("s-review");
  }

  async function submit() {
    const visible = new Set(st.qs.map((q) => q.id));
    const answers = {}, teacher_answers = {};
    for (const [k, v] of Object.entries(st.answers)) {
      if (!visible.has(k)) continue;                       // answers to sub-questions that are hidden again
      const [base, tid] = k.split("@");
      if (tid) (teacher_answers[tid] = teacher_answers[tid] || {})[base] = v;
      else answers[k] = v;
    }
    const btn = $("submit-btn");
    btn.disabled = true;
    btn.textContent = "Изпращаме…";
    $("submit-err").hidden = true;
    try {
      await api("/responses", { method: "POST", body: { code: st.code, duration_s: Math.round((Date.now() - st.started) / 1000), answers, teacher_answers } });
      draftStore.del(draftKey());
      done();
    } catch (e) {
      showErr("submit-err", e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Изпрати отговорите";
    }
  }

  function done() {
    const s = st.s;
    $("done-mark").innerHTML = ICON.check;
    $("done-title").textContent = s.demo ? "Това беше пробната анкета" : s.role === "student" ? "Благодарим ти!" : "Благодарим ви!";
    $("done-text").textContent = s.demo
      ? "Нищо не беше записано. С истински код отговорите влизат анонимно в резултатите на класа и училището."
      : s.role === "student"
        ? "Отговорите ти са записани анонимно. Те ще помогнат училището да стане по-добро място за всички."
        : "Отговорите са записани анонимно. Резултатите ще бъдат публикувани обобщено, след като се съберат достатъчно отговори.";
    const sup = $("done-support");
    sup.hidden = s.role !== "student";
    sup.innerHTML = `${ICON.heart}<p style="margin:10px 0 0">Ако нещо те тревожи или някой те наранява, не е нужно да се справяш сам/а. Можеш да говориш с възрастен, на когото имаш доверие, или да се обадиш на Националната телефонна линия за деца:</p>
      <a class="big" href="tel:116111">${ICON.phone}116 111</a>`;
    sup.querySelector("p").textContent = adapt(sup.querySelector("p").textContent);
    $("done-link").textContent = s.role === "student" ? "Виж публикуваните резултати" : "Вижте публикуваните резултати";
    show("s-done");
  }

  // ------------------------------------------------------------------ draft (this tab only)
  function draftKey() { return "sf-draft:" + st.code.toUpperCase().replace(/[^0-9A-Z]/g, ""); }
  function save() { draftStore.set(draftKey(), { answers: st.answers, idx: st.idx, started: st.started }); }

  // ------------------------------------------------------------------ wiring
  $("start-btn").addEventListener("click", () => {
    if (!$("consent-box").hidden && !$("consent").checked) {
      showErr("intro-err", "Нужно е съгласие от родител, за да продължи анкетата.");
      $("consent").focus();
      return;
    }
    $("intro-err").hidden = true;
    st.idx = 0;
    enterQuestions(false);
  });
  $("consent").addEventListener("change", () => { $("intro-err").hidden = true; });
  $("back-btn").addEventListener("click", goBack);
  $("review-back").addEventListener("click", goBack);
  $("submit-btn").addEventListener("click", submit);

  setupCodeScreen();
  const params = new URLSearchParams(location.search);
  const pre = params.get("code");
  if (pre) {
    // keep the code out of the address bar and history once read
    history.replaceState(null, "", location.pathname);
    $("code").value = pre.toUpperCase();
    start(pre);
  } else if (params.get("demo") !== null) {
    $("demo-box").open = true;
  }
})();
