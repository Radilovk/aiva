// Operator console: waves, classes + one-time codes (printable slips), access keys, demo data.
"use strict";

(function () {
  const { api, esc, store, toast, ICON } = window.SF;
  const $ = (id) => document.getElementById(id);
  const ses = store("session");
  const loc = store("local");   // known school ids, for the key form (no personal data)
  let KEY = ses.get("sf-admin") || "";

  for (const el of document.querySelectorAll("[data-icon]")) el.innerHTML = ICON[el.dataset.icon] || "";

  /** Stable ids from names, so the same school keeps its id (and its trend) across waves. */
  const slug = (s) => String(s || "").toLowerCase().replace(/[„“"'«»]/g, "").trim().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_.-]/gu, "").slice(0, 60);
  const SCOPE = { school_admin: "Директор", teacher: "Учител", inspector: "Инспекторат", researcher: "Изследовател", admin: "Администратор" };

  async function call(path, opts = {}) { return api(path, { ...opts, key: KEY }); }

  // ------------------------------------------------------------------ login
  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    KEY = $("admin-key").value.trim();
    try { await enter(); ses.set("sf-admin", KEY); }
    catch (err) { $("login-err").textContent = err.message; $("login-err").hidden = false; KEY = ""; }
  });
  $("logout").addEventListener("click", () => { ses.del("sf-admin"); KEY = ""; location.reload(); });

  async function enter() {
    await loadWaves();
    $("v-login").hidden = true;
    $("v-main").hidden = false;
    loadKeys();
    loadRequests();
    if (!$("roster").children.length) { addTeacher({ is_class_teacher: true }); addTeacher(); addTeacher(); }
  }

  // ------------------------------------------------------------------ waves
  async function loadWaves() {
    const { waves } = await call("/admin/waves");
    $("waves").innerHTML = waves.length ? waves.slice().reverse().map((w) => `<div class="w" data-id="${esc(w.id)}">
      <div><div class="nm">${esc(w.title)} ${w.demo ? '<span class="chip">демо</span>' : ""} ${w.open ? '<span class="chip primary">отворена</span>' : '<span class="chip">затворена</span>'}</div>
        <div class="small muted">${esc(w.id)} · ${w.classes} класа · кодове ${w.used}/${w.codes} използвани · ${w.responses} отговора${w.computed_at ? " · изчислена " + esc(w.computed_at) : ""}</div>
        ${w.meta?.campaign_alerts?.length ? `<div class="small err">Внимание: еднакви отговори в ${w.meta.campaign_alerts.map((a) => esc(a.unit_id)).join(", ")} – прегледайте преди публикуване.</div>` : ""}</div>
      <div class="acts">
        ${w.demo ? "" : `<button class="btn small" data-act="compute">Изчисли</button><button class="btn small secondary" data-act="toggle">${w.open ? "Затвори" : "Отвори"}</button>`}
        <button class="btn small quiet" data-act="delete">Изтрий</button></div></div>`).join("")
      : `<p class="muted" style="margin:0">Още няма вълни. Създайте първата по-долу.</p>`;
    for (const row of $("waves").querySelectorAll(".w")) {
      const id = row.dataset.id, w = waves.find((x) => x.id === id);
      row.querySelector('[data-act="compute"]')?.addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try { const meta = await computeWave(id, (t) => { btn.textContent = t; }); toast(`Изчислено: ${meta.included} от ${meta.responses} отговора.`); }
        catch (err) { toast(err.message); }
        loadWaves();
      });
      row.querySelector('[data-act="toggle"]')?.addEventListener("click", async () => { await call(`/admin/waves/${encodeURIComponent(id)}/open`, { method: "POST", body: { open: !w.open } }); loadWaves(); });
      row.querySelector('[data-act="delete"]').addEventListener("click", async () => {
        if (!confirm(`Изтриване на „${w.title}“ с всички кодове, отговори и резултати? Това не може да се отмени.`)) return;
        await call(`/admin/waves/${encodeURIComponent(id)}`, { method: "DELETE" }); toast("Изтрито."); loadWaves();
      });
    }
    const open = waves.filter((w) => !w.demo);
    $("c-wave").innerHTML = open.map((w) => `<option value="${esc(w.id)}">${esc(w.title)}</option>`).join("") || `<option value="">първо създайте вълна</option>`;
  }

  $("wave-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = slug($("wave-id").value);
    try { await call("/admin/waves", { method: "POST", body: { id, title: $("wave-title").value.trim() || $("wave-id").value.trim() } }); $("wave-form").reset(); loadWaves(); }
    catch (err) { toast(err.message); }
  });

  // ------------------------------------------------------------------ class + codes
  function addTeacher(t = {}) {
    const r = document.createElement("div");
    r.className = "r";
    r.innerHTML = `<input type="text" placeholder="Име, напр. г-жа Иванова" value="${esc(t.name || "")}" data-f="name">
      <input type="text" placeholder="Предмет" value="${esc(t.subject || "")}" data-f="subject">
      <label class="ct"><input type="radio" name="ct" ${t.is_class_teacher ? "checked" : ""}> класен</label>
      <button class="btn quiet small" type="button" aria-label="Премахни">${ICON.x}</button>`;
    r.querySelector("button").addEventListener("click", () => r.remove());
    $("roster").appendChild(r);
  }
  $("add-teacher").addEventListener("click", () => addTeacher());

  $("class-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("class-err").hidden = true;
    const regionName = $("c-region-name").value.trim(), schoolName = $("c-school-name").value.trim(), className = $("c-class-name").value.trim();
    const regionId = slug(regionName), schoolId = slug(schoolName), classId = `${schoolId}-${slug(className)}`;
    const roster = [...$("roster").children].map((r) => ({
      name: r.querySelector('[data-f="name"]').value.trim(), subject: r.querySelector('[data-f="subject"]').value.trim(),
      is_class_teacher: r.querySelector('input[type="radio"]').checked,
    })).filter((t) => t.name).map((t) => ({ ...t, teacher_id: `${schoolId}-${slug(t.name)}` }));
    const body = { wave: $("c-wave").value, region_id: regionId, region_name: regionName, school_id: schoolId, school_name: schoolName,
      class_id: classId, class_name: className, grade: Number($("c-grade").value), class_size: Number($("c-size").value),
      n_parent: Number($("c-np").value), n_student: Number($("c-ns").value), roster };
    try {
      const r = await call("/admin/classes", { method: "POST", body });
      const schools = loc.get("sf-schools") || {};
      schools[schoolId] = schoolName;
      loc.set("sf-schools", schools);
      showCodes(body, r.codes);
      loadWaves();
    } catch (err) { $("class-err").textContent = err.message; $("class-err").hidden = false; }
  });

  function showCodes(c, codes) {
    const url = new URL("survey.html", location.href).href.replace(/^https?:\/\//, "");
    const all = [...codes.parent.map((k) => ["родител", k]), ...codes.student.map((k) => ["ученик", k])];
    $("codes-out").hidden = false;
    $("codes-out").innerHTML = `<h3 style="margin-top:0">${all.length} кода за ${esc(c.class_name)} · ${esc(c.school_name)}</h3>
      <p class="ink2 small">Показват се само сега – сървърът пази единствено хешовете им. Отпечатайте листчетата, разрежете ги и ги раздайте разбъркано, така че никой да не знае кой какъв код е взел.</p>
      <div class="row"><button class="btn" id="print-btn">Отпечатай листчета</button><button class="btn secondary" id="copy-btn">Копирай като текст</button></div>
      <p class="small muted" style="margin:14px 0 0">Идентификатор на училището (за ключа на директора): <code>${esc(c.school_id)}</code></p>`;
    const direct = (k) => new URL(`survey.html?code=${encodeURIComponent(k)}`, location.href).href;
    $("slips").innerHTML = all.map(([role, k]) => `<div class="slip"><div><div><b>Глас за училището</b> · анкета за ${role === "родител" ? "родители" : "ученици"} · ${esc(c.class_name)}</div>
      <div class="c">${esc(k)}</div><div class="u">Сканирайте кода или отворете <b>${esc(url)}</b> и въведете кода.</div>
      <div class="p">Анонимно: кодът показва само класа и ролята и се използва веднъж. ${role === "ученик" && c.grade <= 7 ? "Родителят отметва съгласие преди началото." : ""}</div></div>
      <div class="q">${SF.qrSvg(direct(k), 2)}</div></div>`).join("");
    $("print-btn").addEventListener("click", () => window.print());
    $("copy-btn").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(all.map(([r, k]) => `${r}\t${k}`).join("\n")); toast("Копирано."); } catch (e) { toast("Копирането не е позволено от браузъра."); }
    });
    $("codes-out").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ------------------------------------------------------------------ school links, QR, posters
  let qrTimer = null;
  $("qr-q").addEventListener("input", () => { clearTimeout(qrTimer); qrTimer = setTimeout(findSchools, 250); });
  async function findSchools() {
    const q = $("qr-q").value.trim();
    if (q.length < 2) { $("qr-list").innerHTML = ""; return; }
    const { schools } = await api(`/schools?q=${encodeURIComponent(q)}`);
    $("qr-list").innerHTML = schools.length ? schools.map((sc) => {
      const link = SF.schoolLink(sc.school_id);
      return `<div class="qr-card"><div class="q">${SF.qrSvg(link)}</div><div><b>${esc(sc.name)}</b><div class="small muted">${esc(sc.region || "")} · ${esc(sc.school_id)}</div>
        <code>${esc(link)}</code><div class="row" style="margin-top:8px"><button class="btn small secondary" data-copy="${esc(link)}">Копирай връзката</button>
        <button class="btn small" data-poster="${esc(sc.school_id)}" data-name="${esc(sc.name)}">Плакат за печат</button></div></div></div>`;
    }).join("") : '<p class="muted small">Няма училище с отворена анкета. Внесете го в регистъра или създайте клас.</p>';
  }
  document.addEventListener("click", async (e) => {
    const cp = e.target.closest("[data-copy]");
    if (cp) { try { await navigator.clipboard.writeText(cp.dataset.copy); toast("Копирано."); } catch { toast("Копирайте ръчно."); } return; }
    const ps = e.target.closest("[data-poster]");
    if (!ps) return;
    const link = SF.schoolLink(ps.dataset.poster);
    $("slips").innerHTML = `<div class="poster"><div><b>Глас за училището</b> · анонимна анкета за родители и ученици</div>
      <h1>Как е в ${esc(ps.dataset.name)}?</h1>
      <div>Сън, натоварване, настроение, безопасност и отношение към децата. Около 6 минути, без имена.</div>
      <div class="q">${SF.qrSvg(link, 8)}</div><div class="u">${esc(link.replace(/^https?:\/\//, ""))}</div>
      <p style="margin-top:8mm;font-size:11pt">Родители – за всяко дете поотделно. Ученици – от 4. клас нагоре.<br>Ако дете е в опасност: 112 · Телефон за деца 116 111</p></div>`;
    window.print();
  });

  // ------------------------------------------------------------------ register import and proposals
  $("reg-btn").addEventListener("click", async () => {
    const rows = $("reg-text").value.split(/\r?\n/).map((l) => l.split(/[;\t]/).map((x) => x.trim())).filter((r) => r[0] && r[1]);
    if (!rows.length) return;
    const msg = $("reg-msg");
    let done = 0, total = 0;
    try {
      for (let i = 0; i < rows.length; i += 500) {
        const schools = rows.slice(i, i + 500).map(([code, name, town, region]) => ({ school_id: code, name, town, region_id: region ? slug(region) : null, region_name: region || null, source: "register" }));
        const r = await call("/admin/schools", { method: "POST", body: { schools } });
        done += r.imported; total = r.total;
        msg.textContent = `Внесени ${done} от ${rows.length}…`;
      }
      msg.textContent = `Готово: ${done} реда. В регистъра има ${total} училища.`;
    } catch (err) { msg.textContent = err.message; }
  });

  async function loadRequests() {
    const { requests } = await call("/admin/school-requests");
    const ROLE = { parent: "родител", student: "ученик", teacher: "учител", director: "директор" };
    $("req-list").innerHTML = requests.length ? requests.map((r) => `<div class="req" data-id="${esc(r.id)}"><div><b>${esc(r.name)}</b>
      <div class="small muted">${esc(r.town || "")}${r.region_name ? " · " + esc(r.region_name) : ""} · предложено от ${esc(ROLE[r.role] || "посетител")} · ${esc(String(r.created_at).slice(0, 10))}</div></div>
      <div class="row"><input type="text" placeholder="код по НЕИСПУО (по желание)" style="width:200px;min-height:38px"><button class="btn small" data-act="approve">Одобри</button><button class="btn small quiet" data-act="reject">Откажи</button></div></div>`).join("")
      : '<p class="muted small">Няма нови предложения.</p>';
  }
  $("req-list").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const row = b.closest(".req");
    const code = row.querySelector("input").value.trim();
    try {
      await call(`/admin/school-requests/${row.dataset.id}`, { method: "POST", body: { action: b.dataset.act, school_id: code || undefined } });
      toast(b.dataset.act === "approve" ? "Училището е добавено." : "Отказано.");
      loadRequests();
    } catch (err) { toast(err.message); }
  });

  // ------------------------------------------------------------------ keys
  function syncKeyForm() {
    const s = $("k-scope").value;
    $("k-school-f").hidden = s !== "school_admin";
    $("k-teacher-f").hidden = s !== "teacher";
    $("k-region-f").hidden = s !== "inspector";
  }
  $("k-scope").addEventListener("change", syncKeyForm);
  syncKeyForm();
  const known = loc.get("sf-schools") || {};
  if (Object.keys(known).length) {
    const dl = document.createElement("datalist");
    dl.id = "schools-dl";
    dl.innerHTML = Object.entries(known).map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join("");
    document.body.appendChild(dl);
    $("k-school").setAttribute("list", "schools-dl");
  }

  $("key-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = { scope: $("k-scope").value, label: $("k-label").value.trim(), school_id: $("k-school").value.trim() || undefined, teacher_id: $("k-teacher").value.trim() || undefined,
      region_id: $("k-region").value.trim() || undefined };
    try {
      const r = await call("/admin/keys", { method: "POST", body });
      $("key-out").hidden = false;
      $("key-out").innerHTML = `<div class="note"><b>Новият ключ се показва само сега.</b> Предайте го лично на получателя.<div class="keyout" style="margin-top:10px">${esc(r.key)}</div></div>`;
      $("key-form").reset(); syncKeyForm(); loadKeys();
    } catch (err) { toast(err.message); }
  });

  async function loadKeys() {
    const { keys } = await call("/admin/keys");
    $("keys").innerHTML = keys.map((k) => `<tr><td>${esc(k.label || "–")}</td><td>${esc(SCOPE[k.scope] || k.scope)}</td><td class="small">${esc(k.school_id || k.teacher_id || k.region_id || (k.scope === "inspector" ? "цялата страна" : "всичко"))}</td>
      <td style="text-align:right"><button class="btn quiet small" data-id="${esc(k.id)}">Отнеми</button></td></tr>`).join("") || `<tr><td colspan="4" class="muted">Няма ключове.</td></tr>`;
    for (const b of $("keys").querySelectorAll("button[data-id]")) b.addEventListener("click", async () => {
      if (!confirm("Да се отнеме ли този ключ?")) return;
      await call(`/admin/keys/${b.dataset.id}`, { method: "DELETE" }); loadKeys();
    });
  }

  // ------------------------------------------------------------------ computing in the browser
  // The Worker stays within the free plan's 10 ms CPU per request: it only exports answers and stores results.
  // The statistics (bootstrap intervals, ranks, shrinkage) run here, with the engine the parity test checks.
  let enginePromise = null;
  function engine() {
    enginePromise ??= new Promise((ok, fail) => {
      const sc = document.createElement("script");
      sc.src = "lib/sf-engine.js";
      sc.onload = () => ok(window.SFEngine);
      sc.onerror = () => { enginePromise = null; fail(new Error("Модулът за изчисление не се зареди.")); };
      document.head.appendChild(sc);
    });
    return enginePromise;
  }
  const paint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

  /** Unit rows in chunks of ~500 KB (the Worker accepts up to 1 MB per request). */
  async function upload(waveId, rows, extra, progress) {
    const chunks = [];
    let cur = [], size = 0;
    for (const r of rows) {
      const n = r.data.length + r.summary.length + 200;
      if (cur.length && (size + n > 500000 || cur.length >= 150)) { chunks.push(cur); cur = []; size = 0; }
      cur.push(r); size += n;
    }
    chunks.push(cur);
    const names = extra.names || [];
    for (let i = 0; i < chunks.length; i++) {
      progress(`Качване ${i + 1}/${chunks.length}…`);
      const last = i === chunks.length - 1;
      await call(`/admin/waves/${encodeURIComponent(waveId)}/units`, { method: "POST", body: {
        reset: i === 0, units: chunks[i], demo: extra.demo || undefined, title: extra.title, created_at: extra.created_at,
        names: i === 0 ? names.slice(0, 500) : [], meta: last ? extra.meta : undefined } });
    }
    for (let i = 500; i < names.length; i += 500) {
      await call(`/admin/waves/${encodeURIComponent(waveId)}/units`, { method: "POST", body: { demo: extra.demo || undefined, title: extra.title, names: names.slice(i, i + 500) } });
    }
  }

  async function computeWave(waveId, progress) {
    const E = await engine();
    const items = [];
    let classSizes = null, after = 0;
    do {
      progress(`Изтегляне… ${items.length}`);
      const page = await call(`/admin/waves/${encodeURIComponent(waveId)}/export?after=${after}`);
      if (page.class_sizes) classSizes = page.class_sizes;
      items.push(...page.items);
      after = page.next;
    } while (after);
    if (!items.length) throw new Error("Няма отговори за тази вълна.");
    progress(`Изчисляване на ${items.length} отговора…`);
    await paint();
    const q = E.loadQuestionnaire();
    const res = E.runWave(q, items.map((x) => x.r), { classSizes: classSizes && Object.keys(classSizes).length ? classSizes : null });
    const rows = E.unitRows(res, items.map((x) => ({ region_id: x.r.region_id, school_id: x.r.school_id, themes: x.t })));
    const meta = { ...res.meta, campaign_alerts: res.campaign_alerts, references: res.references };
    await upload(waveId, rows, { meta }, progress);
    return meta;
  }

  const DEMO_REGIONS = ["Северозападен", "Южен централен", "Югоизточен"];
  const sqlTime = (ms) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);

  $("demo-btn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const E = await engine();
      const defs = [["demo-2026-spring", "Демо · пролет 2026", 7, false, Date.now() - 60000], ["demo-2026-autumn", "Демо · есен 2026", 8, true, Date.now()]];
      for (const [wid, title, seed, campaign, at] of defs) {
        btn.textContent = `Симулиране: ${title}…`;
        await paint();
        const q = E.loadQuestionnaire();
        q.params.bootstrap_reps = 200;
        const s = E.simulate(q, { regions: 3, schoolsPerRegion: 5, seed, campaignClass: campaign });
        const res = E.runWave(q, s.responses, { classSizes: s.truth.class_sizes });
        const rows = E.unitRows(res, s.responses.map((r) => ({ region_id: r.region_id, school_id: r.school_id, themes: null })));
        const names = [
          ...DEMO_REGIONS.map((r, i) => ["region", `R${i + 1}`, `${r} (демо)`]),
          ...Object.keys(res.school).map((sid) => ["school", sid, `Демо училище ${sid.replace(/^R(\d+)-S(\d+)$/, "$1.$2")}`]),
          ...Object.entries(s.classGrades).map(([cid, g]) => ["class", cid, `${g} клас`]),
          ...Object.keys(res.teacher).map((tid) => ["teacher", tid, `Учител ${tid.split("-T")[1]} (демо)`]),
        ];
        await upload(wid, rows, { demo: true, title, created_at: sqlTime(at), names, meta: { ...res.meta, campaign_alerts: res.campaign_alerts, references: res.references } }, (t) => { btn.textContent = t; });
      }
      toast("Демо данните са готови.");
      loadWaves();
    } catch (err) { toast(err.message); }
    btn.disabled = false; btn.textContent = "Генерирай демо данни";
  });

  if (KEY) enter().catch(() => { ses.del("sf-admin"); KEY = ""; });
})();
