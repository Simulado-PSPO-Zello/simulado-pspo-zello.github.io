(() => {
  const EXAM = { questions: 80, minutes: 60, passPct: 85 };
  const IDEAL_SEC = (EXAM.minutes * 60) / EXAM.questions; // 45 s por questão
  const KEY_STATE = "pspo-state";
  const KEY_HISTORY = "pspo-history";
  const KEY_NAME = "pspo-last-name";
  const KEY_LANG = "pspo-lang";
  const KEY_SEEN = "pspo-seen";
  const KEY_PENDING = "pspo-pending"; // tentativas aguardando envio para a nuvem
  const API_URL = (window.API_URL || "").replace(/\/$/, "");
  // Quantas questões de cada área entram nas 80. Product Backlog é o "coração da prova".
  const TOPIC_QUOTA = { backlog: 22, po: 15, events: 14, value: 12, release: 10, fundamentals: 7 };
  // Os dois bancos têm a mesma ordem: o índice é o id da questão nos dois idiomas.
  const BANKS = { pt: window.QUESTIONS, en: window.QUESTIONS_EN };
  for (const bank of Object.values(BANKS)) bank.forEach((q, i) => { q.id = i; });

  const $ = (id) => document.getElementById(id);
  let state = null;
  let tickHandle = null;
  let lang = "pt";

  // ---------- armazenamento ----------
  const store = {
    get(key, fallback) {
      try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* sem storage */ }
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch { /* sem storage */ }
    },
  };
  const save = () => state && store.set(KEY_STATE, state);

  // ---------- idioma ----------
  const t = (key, ...args) => {
    const v = window.I18N[lang][key];
    return typeof v === "function" ? v(...args) : v;
  };
  const topicLabel = (id) => window.I18N[lang].topics[id] ?? id;

  function setLang(next) {
    lang = window.I18N[next] ? next : "pt";
    document.documentElement.lang = t("htmlLang");
    document.title = t("title");
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    document.querySelectorAll("#lang-switch button").forEach((b) => b.classList.toggle("active", b.dataset.lang === lang));
    $("lang-switch").setAttribute("aria-label", t("langLabel"));
  }

  // ---------- nuvem (API no Neon Functions) ----------
  async function api(path, options = {}) {
    if (!API_URL) throw new Error("API_URL não configurada");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      const token = await window.Auth.token();
      const res = await fetch(API_URL + path, {
        ...options,
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(options.headers || {}),
        },
      });
      const data = await res.json().catch(() => null);
      // Sessão inválida ou conta de outro domínio: volta para o login.
      if (res.status === 401 || res.status === 403 && data?.error === "forbidden_domain") {
        await window.Auth.signOut();
        showLogin(res.status === 403 ? t("errForbidden", window.Auth.domain) : "");
      }
      return { ok: res.ok, status: res.status, data };
    } finally {
      clearTimeout(timer);
    }
  }

  // Envia uma tentativa. Falha de rede, 5xx ou 429 => guarda na fila para reenviar depois.
  // 4xx (dado inválido) não adianta reenviar.
  async function sendAttempt(payload) {
    try {
      const r = await api("/attempts", { method: "POST", body: JSON.stringify(payload) });
      if (r.ok) return "saved";
      // 401: sessão expirou; guarda e reenvia depois do novo login.
      if (r.status === 401 || r.status === 429 || r.status >= 500) return "retry";
      return "rejected";
    } catch {
      return "retry";
    }
  }

  // Reenvia só as pendências da pessoa logada (o aparelho pode ser compartilhado).
  async function flushPending() {
    const pending = store.get(KEY_PENDING, []);
    const me = window.Auth.user?.email;
    if (!pending.length || !me) return;
    const still = [];
    for (const p of pending) {
      if (p.owner !== me) { still.push(p); continue; }
      if ((await sendAttempt(p.payload)) === "retry") still.push(p);
    }
    store.set(KEY_PENDING, still);
  }

  async function submitToCloud(payload) {
    const el = $("cloud-status");
    el.className = "cloud-status";
    el.textContent = t("cloudSaving");
    const result = await sendAttempt(payload);
    if (result === "saved") {
      el.className = "cloud-status ok";
      el.textContent = t("cloudSaved");
    } else if (result === "retry") {
      const entry = { owner: window.Auth.user?.email, payload };
      store.set(KEY_PENDING, [...store.get(KEY_PENDING, []), entry].slice(-20));
      el.className = "cloud-status warn";
      el.textContent = t("cloudQueued");
    } else {
      el.className = "cloud-status warn";
      el.textContent = t("cloudRejected");
    }
  }

  async function renderRanking() {
    const box = $("ranking-body");
    box.innerHTML = `<p class="muted small">${t("loading")}</p>`;
    try {
      const r = await api("/ranking");
      if (!r.ok) throw new Error(String(r.status));
      if (!r.data.length) { box.innerHTML = `<p class="muted">${t("rankingEmpty")}</p>`; return; }
      box.innerHTML = `<div class="table-wrap"><table><thead><tr><th>${t("thPos")}</th><th>${t("thName")}</th><th>${t("thScore")}</th><th>${t("thTime")}</th><th>${t("thAttempts")}</th><th>${t("thResult")}</th></tr></thead><tbody>
        ${r.data.map((x, i) => `<tr class="${i === 0 ? "rank-1" : ""}">
          <td>${i + 1}º</td><td>${esc(x.name)}</td><td>${x.pct}%</td><td>${fmtTime(x.duration)}</td><td>${x.attempts}</td>
          <td class="${x.pct >= EXAM.passPct ? "pass-txt" : "fail-txt"}">${t(x.pct >= EXAM.passPct ? "pass" : "fail")}</td></tr>`).join("")}
        </tbody></table></div>`;
    } catch {
      box.innerHTML = `<p class="muted small">${t("offline")}</p>`;
    }
  }

  async function renderCloudHistory() {
    const box = $("history-cloud");
    box.innerHTML = `<p class="muted small">${t("loading")}</p>`;
    try {
      const r = await api("/me/history");
      if (!r.ok) throw new Error(String(r.status));
      box.innerHTML = r.data.length ? historyTable(r.data) : `<p class="muted">${t("historyEmpty")}</p>`;
    } catch {
      box.innerHTML = `<p class="muted small">${t("offline")}</p>`;
    }
  }

  // ---------- login ----------
  let loginEmail = "";

  function renderLoginTexts() {
    const d = window.Auth.domain;
    $("login-sub").textContent = t("loginSub", d);
    $("login-email").placeholder = t("emailPlaceholder", d);
    if (loginEmail) $("login-sent").textContent = t("codeSentTo", loginEmail);
  }

  function loginError(msg) {
    $("login-error").textContent = msg || "";
    $("login-error").classList.toggle("hidden", !msg);
  }

  function loginStep(step) {
    $("login-email-form").classList.toggle("hidden", step !== "email");
    $("login-code-form").classList.toggle("hidden", step !== "code");
    (step === "email" ? $("login-email") : $("login-code")).focus();
  }

  function showLogin(message = "") {
    clearInterval(tickHandle);
    $("name-dialog").close?.();
    $("confirm-dialog").close?.();
    setLang(store.get(KEY_LANG, lang));
    show("login");
    renderLoginTexts();
    loginStep("email");
    loginError(message);
  }

  const busy = (btn, on, label) => {
    btn.disabled = on;
    btn.textContent = t(on ? label : btn.dataset.i18n);
  };

  // Traduz o erro do servidor de login; o detalhe técnico vai junto para facilitar o suporte.
  function authErrorText(raw, fallbackKey) {
    if (/too.?many|429/i.test(raw)) return t("errTooMany");
    if (/network|failed to fetch|load failed/i.test(raw)) return `${t("errNetwork")} (${raw})`;
    return `${t(fallbackKey)} (${raw})`;
  }

  async function requestCode() {
    const email = $("login-email").value.trim().toLowerCase();
    loginError("");
    if (!window.Auth.isAllowed(email)) { loginError(t("errDomain", window.Auth.domain)); return; }
    busy($("btn-send-code"), true, "sendingCode");
    const r = await window.Auth.sendCode(email).catch((e) => ({ error: `network · ${e?.message || e}` }));
    busy($("btn-send-code"), false);
    if (r.error) { loginError(authErrorText(r.error, "errSend")); return; }
    loginEmail = email;
    $("login-code").value = "";
    renderLoginTexts();
    loginStep("code");
  }

  async function verifyCode() {
    loginError("");
    busy($("btn-verify"), true, "verifying");
    const r = await window.Auth.verifyCode(loginEmail, $("login-code").value).catch((e) => ({ error: `network · ${e?.message || e}` }));
    busy($("btn-verify"), false);
    if (r.error || !r.user) { loginError(authErrorText(r.error || "no_user", "errCode")); return; }
    if (!window.Auth.isAllowed(r.user.email)) {
      await window.Auth.signOut();
      loginStep("email");
      loginError(t("errForbidden", window.Auth.domain));
      return;
    }
    loginEmail = "";
    afterLogin();
  }

  // Nome sugerido no Modo Prova: o último usado, o nome da conta ou o começo do e-mail.
  function suggestedName() {
    const u = window.Auth.user;
    if (store.get(KEY_NAME, "")) return store.get(KEY_NAME, "");
    if (u?.name) return u.name;
    const local = (u?.email || "").split("@")[0];
    return local.split(/[._-]+/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join(" ");
  }

  // ---------- utilidades ----------
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const fmtTime = (sec) => {
    sec = Math.max(0, Math.round(sec));
    return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

  // Embaralha as opções (exceto V/F) e remapeia os índices das respostas.
  function prepareQuestion(q) {
    if (q.type === "tf") return { ...q, options: q.options.slice(), answer: q.answer.slice() };
    const order = shuffle(q.options.map((_, i) => i));
    return {
      ...q,
      options: order.map((i) => q.options[i]),
      answer: q.answer.map((a) => order.indexOf(a)).sort((x, y) => x - y),
    };
  }

  // Sorteia respeitando a cota de cada área, priorizando as questões que menos caíram
  // nas provas anteriores (rodízio). Completa com o restante se faltar.
  function pickQuestions() {
    const seen = store.get(KEY_SEEN, {});
    const pool = shuffle(BANKS[lang]).sort((a, b) => (seen[a.id] || 0) - (seen[b.id] || 0));
    const picked = [];
    for (const [topic, n] of Object.entries(TOPIC_QUOTA)) {
      picked.push(...pool.filter((q) => q.topic === topic).slice(0, n));
    }
    const rest = pool.filter((q) => !picked.includes(q));
    picked.push(...rest.slice(0, Math.max(0, EXAM.questions - picked.length)));
    const chosen = shuffle(picked.slice(0, EXAM.questions));
    for (const q of chosen) seen[q.id] = (seen[q.id] || 0) + 1;
    store.set(KEY_SEEN, seen);
    return chosen;
  }

  // Enunciado + selo indicando quantas respostas escolher nas questões de múltipla resposta.
  function questionHtml(q) {
    if (q.type !== "multi") return esc(q.q);
    const text = q.q.replace(/\s*\((Escolha|Choose) \d+\)\s*$/, "");
    return `${esc(text)} <span class="multi-badge">${t("choose", q.answer.length)}</span>`;
  }

  // ---------- telas ----------
  function show(screen) {
    for (const s of ["login", "home", "quiz", "result"]) $(`screen-${s}`).classList.toggle("hidden", s !== screen);
    // A tela de login ocupa a página inteira (layout em duas colunas, sem o cabeçalho).
    document.body.classList.toggle("on-login", screen === "login");
    $("exam-status").classList.toggle("hidden", screen !== "quiz");
    // O idioma só pode ser trocado fora da prova; a prova segue no idioma em que começou.
    $("lang-switch").classList.toggle("hidden", screen !== "home" && screen !== "login");
    const u = window.Auth.user;
    $("user-box").classList.toggle("hidden", !u || screen === "login" || screen === "quiz");
    $("user-email").textContent = u?.email || "";
    window.scrollTo(0, 0);
  }

  // ---------- início ----------
  function start(mode, name = "") {
    const qs = pickQuestions().map(prepareQuestion);
    const now = Date.now();
    state = {
      mode,
      name,
      lang,
      questions: qs,
      answers: qs.map(() => []),
      checked: qs.map(() => false),
      flags: qs.map(() => false),
      time: qs.map(() => 0),
      current: 0,
      startedAt: now,
      lastSwitch: now,
      deadline: mode === "exam" ? now + EXAM.minutes * 60 * 1000 : null,
    };
    save();
    enterQuiz();
  }

  function enterQuiz() {
    setLang(state.lang || "pt");
    show("quiz");
    $("timer").classList.toggle("hidden", state.mode !== "exam");
    $("candidate").textContent = state.name || "";
    clearInterval(tickHandle);
    tickHandle = setInterval(tick, 1000);
    tick();
    renderQuestion();
  }

  function tick() {
    if (!state) return;
    if (state.mode === "exam") {
      const left = (state.deadline - Date.now()) / 1000;
      const el = $("timer");
      el.textContent = fmtTime(left);
      el.classList.toggle("warn", left <= 600 && left > 120);
      el.classList.toggle("danger", left <= 120);
      if (left <= 0) { finish(true); return; }
    }
    // Salva periodicamente o tempo gasto para sobreviver a um refresh.
    accumulateTime();
    save();
  }

  function accumulateTime() {
    const now = Date.now();
    state.time[state.current] += (now - state.lastSwitch) / 1000;
    state.lastSwitch = now;
  }

  function goTo(i) {
    if (i < 0 || i >= state.questions.length) return;
    accumulateTime();
    state.current = i;
    save();
    renderQuestion();
  }

  // ---------- questão ----------
  function renderQuestion() {
    const i = state.current;
    const q = state.questions[i];
    const selected = state.answers[i];
    const locked = state.mode === "study" && state.checked[i];

    $("q-number").textContent = t("questionOf", i + 1, state.questions.length);
    $("q-type").textContent = t("types")[q.type];
    $("q-topic").textContent = topicLabel(q.topic);
    $("q-text").innerHTML = questionHtml(q);
    $("chk-flag").checked = state.flags[i];

    const inputType = q.type === "multi" ? "checkbox" : "radio";
    $("q-options").innerHTML = q.options.map((opt, idx) => {
      const isSel = selected.includes(idx);
      let cls = "option";
      if (locked) {
        cls += " locked";
        if (q.answer.includes(idx)) cls += " correct";
        else if (isSel) cls += " wrong";
      } else if (isSel) cls += " selected";
      return `<label class="${cls}">
        <input type="${inputType}" name="opt" value="${idx}" ${isSel ? "checked" : ""} ${locked ? "disabled" : ""}>
        <span>${esc(opt)}</span></label>`;
    }).join("");

    const fb = $("q-feedback");
    if (locked) {
      const ok = sameSet(selected, q.answer);
      fb.className = `feedback ${ok ? "ok" : "bad"}`;
      fb.innerHTML = `<strong>${t(ok ? "correct" : "incorrect")}</strong> ${esc(q.exp)}`;
    } else {
      fb.className = "feedback hidden";
    }

    $("btn-prev").disabled = i === 0;
    const last = i === state.questions.length - 1;
    $("btn-check").classList.toggle("hidden", state.mode !== "study" || locked);
    $("btn-check").disabled = selected.length === 0;
    $("btn-next").textContent = t(last ? "reviewFinish" : "next");
    $("progress-text").textContent = t("answeredOf", answeredCount(), state.questions.length);
    renderGrid();
  }

  function onOptionChange(e) {
    if (e.target.name !== "opt") return;
    const q = state.questions[state.current];
    const idx = Number(e.target.value);
    let sel = state.answers[state.current];
    if (q.type === "multi") {
      sel = e.target.checked ? [...sel, idx] : sel.filter((x) => x !== idx);
    } else {
      sel = [idx];
    }
    state.answers[state.current] = sel.sort((a, b) => a - b);
    save();
    renderQuestion();
  }

  const answeredCount = () => state.answers.filter((a) => a.length > 0).length;

  function renderGrid() {
    $("q-grid").innerHTML = state.questions.map((q, i) => {
      let cls = "q-cell";
      if (state.mode === "study" && state.checked[i]) {
        cls += sameSet(state.answers[i], q.answer) ? " correct" : " wrong";
      } else if (state.flags[i]) cls += " flagged";
      else if (state.answers[i].length) cls += " answered";
      if (i === state.current) cls += " current";
      return `<button class="${cls}" data-i="${i}">${i + 1}</button>`;
    }).join("");
  }

  // ---------- finalização ----------
  function askFinish() {
    const blank = state.questions.length - answeredCount();
    const flagged = state.flags.filter(Boolean).length;
    const parts = [];
    if (blank) parts.push(t("blankCount", blank));
    if (flagged) parts.push(t("flaggedCount", flagged));
    $("confirm-text").textContent = parts.length ? t("confirmPending", parts.join(t("and"))) : t("confirmDone");
    $("confirm-dialog").showModal();
  }

  function finish(timeUp = false) {
    clearInterval(tickHandle);
    accumulateTime();
    const finishedAt = Date.now();
    const total = state.questions.length;
    const results = state.questions.map((q, i) => ({
      q, selected: state.answers[i], flagged: state.flags[i], time: state.time[i],
      correct: sameSet(state.answers[i], q.answer),
    }));
    const correct = results.filter((r) => r.correct).length;
    const pct = Math.round((correct / total) * 1000) / 10;

    const topics = {};
    for (const r of results) {
      topics[r.q.topic] ??= { correct: 0, total: 0 };
      topics[r.q.topic].total++;
      if (r.correct) topics[r.q.topic].correct++;
    }

    const summary = {
      date: finishedAt,
      mode: state.mode,
      name: state.name || "",
      lang: state.lang || "pt",
      correct, total, pct,
      pass: pct >= EXAM.passPct,
      duration: (finishedAt - state.startedAt) / 1000,
      timeUp,
      topics,
    };
    const history = store.get(KEY_HISTORY, []);
    history.unshift(summary);
    store.set(KEY_HISTORY, history.slice(0, 50));
    const payload = state.mode === "exam" && summary.name ? {
      name: summary.name, mode: summary.mode, lang: summary.lang,
      duration: Math.round(summary.duration), timeUp,
      answers: results
        .filter((r) => Number.isInteger(r.q.id))
        .map((r) => ({ id: r.q.id, topic: r.q.topic, answered: r.selected.length > 0, correct: r.correct, time: Math.round(r.time) })),
    } : null;
    store.remove(KEY_STATE);
    state = null;

    renderResult(summary, results);
    // Só o Modo Prova (que tem nome) vai para a nuvem.
    $("cloud-status").classList.toggle("hidden", !payload);
    if (payload) submitToCloud(payload);
  }

  // ---------- resultado ----------
  function renderResult(s, results) {
    show("result");
    const badge = $("result-badge");
    badge.textContent = t(s.pass ? "passed" : "failed");
    badge.className = `badge ${s.pass ? "pass" : "fail"}`;
    $("result-pct").textContent = `${s.pct}%`;
    $("result-detail").textContent =
      (s.name ? `${s.name} · ` : "") +
      t("resultDetail", s.correct, s.total, EXAM.passPct, Math.ceil(s.total * EXAM.passPct / 100)) +
      (s.timeUp ? t("timeUp") : "") + (s.mode === "study" ? t("studyMode") : "");

    const answered = results.filter((r) => r.selected.length).length;
    const avg = answered ? results.reduce((sum, r) => sum + r.time, 0) / s.total : 0;
    const slowest = results.slice().sort((a, b) => b.time - a.time)[0];
    $("result-stats").innerHTML = [
      [t("statTotal"), fmtTime(s.duration)],
      [t("statAvg"), `${Math.round(avg)} s`],
      [t("statBlank"), s.total - answered],
      [t("statSlowest"), slowest ? `${Math.round(slowest.time)} s` : "-"],
    ].map(([l, v]) => `<div class="stat"><div class="stat-label">${l}</div><div class="stat-value">${v}</div></div>`).join("");

    $("result-topics").innerHTML = Object.entries(s.topics)
      .sort((a, b) => a[1].correct / a[1].total - b[1].correct / b[1].total)
      .map(([id, tp]) => {
        const p = Math.round((tp.correct / tp.total) * 100);
        const color = p >= EXAM.passPct ? "var(--ok)" : p >= 70 ? "var(--warn)" : "var(--bad)";
        return `<div class="topic-row"><span>${esc(topicLabel(id))}</span>
          <div class="bar"><div class="bar-fill" style="width:${p}%;background:${color}"></div><div class="bar-mark"></div></div>
          <span class="topic-pct">${tp.correct}/${tp.total} · ${p}%</span></div>`;
      }).join("");

    const maxT = Math.max(IDEAL_SEC * 2, ...results.map((r) => r.time));
    $("result-timeline").innerHTML =
      results.map((r, i) => {
        const h = Math.max(2, (r.time / maxT) * 100);
        const color = r.correct ? "var(--ok)" : "var(--bad)";
        return `<div class="tl-bar" style="height:${h}%;background:${color}" title="Q${i + 1}: ${Math.round(r.time)} s · ${t(r.correct ? "hit" : "miss")}"></div>`;
      }).join("") + `<div class="tl-ideal" style="bottom:${(IDEAL_SEC / maxT) * 100}%"></div>`;

    const renderReview = (filter) => {
      $("result-review").innerHTML = results.map((r, i) => ({ r, i }))
        .filter(({ r }) => filter === "all" || (filter === "wrong" && !r.correct) || (filter === "flagged" && r.flagged))
        .map(({ r, i }) => `<div class="review-item">
          <div class="q-meta"><span>${t("question", i + 1)}</span>
            <span class="tag">${t("types")[r.q.type]}</span>
            <span class="tag tag-soft">${esc(topicLabel(r.q.topic))}</span>
            <span class="${r.correct ? "pass-txt" : "fail-txt"}">${t(r.correct ? "reviewHit" : r.selected.length ? "reviewMiss" : "reviewBlank")}</span>
            <span class="muted small">${Math.round(r.time)} s</span></div>
          <p class="q-text">${questionHtml(r.q)}</p>
          <div class="options">${r.q.options.map((o, idx) => {
            let cls = "option";
            if (r.q.answer.includes(idx)) cls += " correct";
            else if (r.selected.includes(idx)) cls += " wrong";
            const mark = r.selected.includes(idx) ? "●" : "○";
            return `<div class="${cls}"><span>${mark}</span><span>${esc(o)}</span></div>`;
          }).join("")}</div>
          <div class="exp">${esc(r.q.exp)}</div></div>`).join("") || `<p class="muted">${t("noneInFilter")}</p>`;
    };
    document.querySelectorAll(".chip").forEach((c) => {
      c.classList.toggle("active", c.dataset.filter === "all");
      c.onclick = () => {
        document.querySelectorAll(".chip").forEach((x) => x.classList.toggle("active", x === c));
        renderReview(c.dataset.filter);
      };
    });
    renderReview("all");
  }

  // ---------- histórico ----------
  // Tabela usada tanto para o histórico local quanto para o da nuvem.
  function historyTable(h) {
    const exams = h.filter((x) => x.mode === "exam");
    const best = exams.length ? Math.max(...exams.map((x) => x.pct)) : "-";
    const avg = exams.length ? (exams.reduce((sum, x) => sum + x.pct, 0) / exams.length).toFixed(1) : "-";
    return `
      <p class="muted small">${t("historySummary", exams.length, best, avg, exams.filter((x) => x.pass).length)}</p>
      <div class="table-wrap"><table><thead><tr><th>${t("thDate")}</th><th>${t("thName")}</th><th>${t("thMode")}</th><th>${t("thScore")}</th><th>${t("thCorrect")}</th><th>${t("thTime")}</th><th>${t("thResult")}</th></tr></thead><tbody>
      ${h.map((x) => `<tr>
        <td>${new Date(x.date).toLocaleString(t("locale"), { dateStyle: "short", timeStyle: "short" })}</td>
        <td>${esc(x.name || "-")}</td>
        <td>${t(x.mode === "exam" ? "modeExam" : "modeStudy")} · ${(x.lang || "pt").toUpperCase()}</td>
        <td>${x.pct}%</td>
        <td>${x.correct}/${x.total}</td>
        <td>${fmtTime(x.duration)}</td>
        <td class="${x.pass ? "pass-txt" : "fail-txt"}">${t(x.pass ? "pass" : "fail")}</td></tr>`).join("")}
      </tbody></table></div>`;
  }

  function renderHistory() {
    const h = store.get(KEY_HISTORY, []);
    if (!h.length) {
      $("history-body").innerHTML = `<p class="muted">${t("historyEmpty")}</p>`;
      return;
    }
    $("history-body").innerHTML = historyTable(h) +
      `<div class="center"><button id="btn-clear" class="btn">${t("clearHistory")}</button></div>`;
    // Janela própria em vez de confirm(): alguns navegadores embutidos bloqueiam o confirm().
    $("btn-clear").onclick = () => $("clear-dialog").showModal();
  }

  function goHome() {
    setLang(store.get(KEY_LANG, lang));
    renderHistory();
    show("home");
    // Envia pendências primeiro, para o ranking e o histórico já virem atualizados.
    flushPending().finally(() => {
      renderRanking();
      renderCloudHistory();
    });
  }

  // Depois do login (ou com sessão restaurada): retoma prova em andamento ou vai ao início.
  function afterLogin() {
    const saved = store.get(KEY_STATE, null);
    if (saved && saved.questions) {
      state = saved;
      state.lastSwitch = Date.now(); // tempo com a página fechada não conta para a questão
      setLang(state.lang || "pt");
      if (state.mode === "exam" && Date.now() >= state.deadline) finish(true);
      else enterQuiz();
    } else {
      goHome();
    }
  }

  // ---------- eventos ----------
  document.querySelectorAll("#lang-switch button").forEach((b) => b.addEventListener("click", () => {
    store.set(KEY_LANG, b.dataset.lang);
    setLang(b.dataset.lang);
    if (!window.Auth.user) { renderLoginTexts(); return; }
    renderHistory();
    renderRanking();
    renderCloudHistory();
  }));
  $("login-email-form").addEventListener("submit", (e) => { e.preventDefault(); requestCode(); });
  $("login-code-form").addEventListener("submit", (e) => { e.preventDefault(); verifyCode(); });
  $("btn-change-email").addEventListener("click", () => { loginEmail = ""; loginError(""); loginStep("email"); });
  $("btn-resend").addEventListener("click", () => { $("login-email").value = loginEmail; requestCode(); });
  $("btn-signout").addEventListener("click", async () => { await window.Auth.signOut(); showLogin(); });
  document.querySelectorAll(".mode-card").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.mode !== "exam") { start(b.dataset.mode); return; }
    $("name-input").value = suggestedName();
    $("name-dialog").showModal();
    $("name-input").select();
  }));
  $("name-form").addEventListener("submit", (e) => {
    const name = $("name-input").value.trim();
    if (!name) { e.preventDefault(); $("name-input").focus(); return; }
    store.set(KEY_NAME, name);
    start("exam", name);
  });
  $("name-cancel").addEventListener("click", () => $("name-dialog").close());
  $("q-options").addEventListener("change", onOptionChange);
  $("btn-prev").addEventListener("click", () => goTo(state.current - 1));
  $("btn-next").addEventListener("click", () => {
    if (state.current === state.questions.length - 1) askFinish();
    else goTo(state.current + 1);
  });
  $("btn-check").addEventListener("click", () => {
    state.checked[state.current] = true;
    save();
    renderQuestion();
  });
  $("chk-flag").addEventListener("change", (e) => {
    state.flags[state.current] = e.target.checked;
    save();
    renderGrid();
  });
  $("q-grid").addEventListener("click", (e) => {
    const b = e.target.closest(".q-cell");
    if (b) goTo(Number(b.dataset.i));
  });
  $("btn-finish").addEventListener("click", askFinish);
  $("confirm-no").addEventListener("click", () => $("confirm-dialog").close());
  $("confirm-yes").addEventListener("click", () => { $("confirm-dialog").close(); finish(false); });
  $("btn-home").addEventListener("click", goHome);
  $("clear-no").addEventListener("click", () => $("clear-dialog").close());
  $("clear-yes").addEventListener("click", () => {
    store.remove(KEY_HISTORY);
    $("clear-dialog").close();
    renderHistory();
  });

  // ---------- início: exige login ----------
  setLang(store.get(KEY_LANG, lang));
  if (location.protocol === "file:") {
    // Aberto com dois cliques: o servidor de login não aceita páginas sem endereço http(s).
    showLogin(t("errFileProtocol"));
    $("login-email-form").classList.add("hidden");
  } else {
    window.Auth.init().then((user) => (user ? afterLogin() : showLogin()));
  }
})();
