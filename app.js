(() => {
  const EXAM = { questions: 80, minutes: 60, passPct: 85 };
  const IDEAL_SEC = (EXAM.minutes * 60) / EXAM.questions; // 45 s por questão
  const KEY_STATE = "pspo-state";
  const KEY_HISTORY = "pspo-history";
  const KEY_NAME = "pspo-last-name";
  // Quantas questões de cada área entram nas 80. Product Backlog é o "coração da prova".
  const TOPIC_QUOTA = {
    "Gestão do Product Backlog": 22,
    "Papel do Product Owner": 15,
    "PO nos Eventos Scrum": 14,
    "Produto, Visão e Valor": 12,
    "Release e Entrega de Valor": 10,
    "Fundamentos do Scrum": 7,
  };
  const TYPE_LABEL ={ single: "Múltipla escolha", multi: "Múltipla resposta", tf: "Verdadeiro/Falso" };

  const $ = (id) => document.getElementById(id);
  let state = null;
  let tickHandle = null;

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

  // Sorteia respeitando a cota de cada área; completa com o restante se faltar.
  function pickQuestions() {
    const pool = shuffle(window.QUESTIONS);
    const picked = [];
    for (const [topic, n] of Object.entries(TOPIC_QUOTA)) {
      picked.push(...pool.filter((q) => q.topic === topic).slice(0, n));
    }
    const rest = pool.filter((q) => !picked.includes(q));
    picked.push(...rest.slice(0, Math.max(0, EXAM.questions - picked.length)));
    return shuffle(picked.slice(0, EXAM.questions));
  }

  // Enunciado + selo indicando quantas respostas escolher nas questões de múltipla resposta.
  function questionHtml(q) {
    if (q.type !== "multi") return esc(q.q);
    const text = q.q.replace(/\s*\(Escolha \d+\)\s*$/, "");
    return `${esc(text)} <span class="multi-badge">Escolha ${q.answer.length}</span>`;
  }

  // ---------- telas ----------
  function show(screen) {
    for (const s of ["home", "quiz", "result"]) $(`screen-${s}`).classList.toggle("hidden", s !== screen);
    $("exam-status").classList.toggle("hidden", screen !== "quiz");
    window.scrollTo(0, 0);
  }

  // ---------- início ----------
  function start(mode, name = "") {
    const qs = pickQuestions().map(prepareQuestion);
    const now = Date.now();
    state = {
      mode,
      name,
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
      const t = $("timer");
      t.textContent = fmtTime(left);
      t.classList.toggle("warn", left <= 600 && left > 120);
      t.classList.toggle("danger", left <= 120);
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

    $("q-number").textContent = `Questão ${i + 1} de ${state.questions.length}`;
    $("q-type").textContent = TYPE_LABEL[q.type];
    $("q-topic").textContent = q.topic;
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
      fb.innerHTML = `<strong>${ok ? "Correto!" : "Incorreto."}</strong> ${esc(q.exp)}`;
    } else {
      fb.className = "feedback hidden";
    }

    $("btn-prev").disabled = i === 0;
    const last = i === state.questions.length - 1;
    $("btn-check").classList.toggle("hidden", state.mode !== "study" || locked);
    $("btn-check").disabled = selected.length === 0;
    $("btn-next").textContent = last ? "Revisar e finalizar" : "Próxima →";
    $("progress-text").textContent = `${answeredCount()}/${state.questions.length} respondidas`;
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
    if (blank) parts.push(`${blank} questão(ões) em branco`);
    if (flagged) parts.push(`${flagged} marcada(s) para revisar`);
    $("confirm-text").textContent = parts.length
      ? `Você ainda tem ${parts.join(" e ")}. Deseja finalizar mesmo assim?`
      : "Deseja finalizar o simulado e ver o resultado?";
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
      correct, total, pct,
      pass: pct >= EXAM.passPct,
      duration: (finishedAt - state.startedAt) / 1000,
      timeUp,
      topics,
    };
    const history = store.get(KEY_HISTORY, []);
    history.unshift(summary);
    store.set(KEY_HISTORY, history.slice(0, 50));
    store.remove(KEY_STATE);
    state = null;

    renderResult(summary, results);
  }

  // ---------- resultado ----------
  function renderResult(s, results) {
    show("result");
    const badge = $("result-badge");
    badge.textContent = s.pass ? "APROVADO" : "REPROVADO";
    badge.className = `badge ${s.pass ? "pass" : "fail"}`;
    $("result-pct").textContent = `${s.pct}%`;
    $("result-detail").textContent =
      (s.name ? `${s.name} · ` : "") +
      `${s.correct} de ${s.total} corretas · mínimo ${EXAM.passPct}% (${Math.ceil(s.total * EXAM.passPct / 100)} acertos)` +
      (s.timeUp ? " · tempo esgotado" : "") + (s.mode === "study" ? " · modo estudo" : "");

    const answered = results.filter((r) => r.selected.length).length;
    const avg = answered ? results.reduce((t, r) => t + r.time, 0) / s.total : 0;
    const slowest = results.slice().sort((a, b) => b.time - a.time)[0];
    $("result-stats").innerHTML = [
      ["Tempo total", fmtTime(s.duration)],
      ["Média por questão", `${Math.round(avg)} s`],
      ["Em branco", s.total - answered],
      ["Mais demorada", slowest ? `${Math.round(slowest.time)} s` : "-"],
    ].map(([l, v]) => `<div class="stat"><div class="stat-label">${l}</div><div class="stat-value">${v}</div></div>`).join("");

    $("result-topics").innerHTML = Object.entries(s.topics)
      .sort((a, b) => a[1].correct / a[1].total - b[1].correct / b[1].total)
      .map(([name, t]) => {
        const p = Math.round((t.correct / t.total) * 100);
        const color = p >= EXAM.passPct ? "var(--ok)" : p >= 70 ? "var(--warn)" : "var(--bad)";
        return `<div class="topic-row"><span>${esc(name)}</span>
          <div class="bar"><div class="bar-fill" style="width:${p}%;background:${color}"></div><div class="bar-mark"></div></div>
          <span class="topic-pct">${t.correct}/${t.total} · ${p}%</span></div>`;
      }).join("");

    const maxT = Math.max(IDEAL_SEC * 2, ...results.map((r) => r.time));
    $("result-timeline").innerHTML =
      results.map((r, i) => {
        const h = Math.max(2, (r.time / maxT) * 100);
        const color = r.correct ? "var(--ok)" : "var(--bad)";
        return `<div class="tl-bar" style="height:${h}%;background:${color}" title="Q${i + 1}: ${Math.round(r.time)} s · ${r.correct ? "acerto" : "erro"}"></div>`;
      }).join("") + `<div class="tl-ideal" style="bottom:${(IDEAL_SEC / maxT) * 100}%"></div>`;

    const renderReview = (filter) => {
      $("result-review").innerHTML = results.map((r, i) => ({ r, i }))
        .filter(({ r }) => filter === "all" || (filter === "wrong" && !r.correct) || (filter === "flagged" && r.flagged))
        .map(({ r, i }) => `<div class="review-item">
          <div class="q-meta"><span>Questão ${i + 1}</span>
            <span class="tag">${TYPE_LABEL[r.q.type]}</span>
            <span class="tag tag-soft">${esc(r.q.topic)}</span>
            <span class="${r.correct ? "pass-txt" : "fail-txt"}">${r.correct ? "✓ Acertou" : r.selected.length ? "✗ Errou" : "— Em branco"}</span>
            <span class="muted small">${Math.round(r.time)} s</span></div>
          <p class="q-text">${questionHtml(r.q)}</p>
          <div class="options">${r.q.options.map((o, idx) => {
            let cls = "option";
            if (r.q.answer.includes(idx)) cls += " correct";
            else if (r.selected.includes(idx)) cls += " wrong";
            const mark = r.selected.includes(idx) ? "●" : "○";
            return `<div class="${cls}"><span>${mark}</span><span>${esc(o)}</span></div>`;
          }).join("")}</div>
          <div class="exp">${esc(r.q.exp)}</div></div>`).join("") || `<p class="muted">Nenhuma questão neste filtro.</p>`;
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
  function renderHistory() {
    const h = store.get(KEY_HISTORY, []);
    if (!h.length) {
      $("history-body").innerHTML = `<p class="muted">Nenhuma tentativa ainda. Seus resultados aparecerão aqui.</p>`;
      return;
    }
    const exams = h.filter((x) => x.mode === "exam");
    const best = exams.length ? Math.max(...exams.map((x) => x.pct)) : null;
    const avg = exams.length ? exams.reduce((t, x) => t + x.pct, 0) / exams.length : null;
    $("history-body").innerHTML = `
      <p class="muted small">${exams.length} prova(s) · melhor nota ${best ?? "-"}% · média ${avg != null ? avg.toFixed(1) : "-"}% · aprovações ${exams.filter((x) => x.pass).length}</p>
      <table><thead><tr><th>Data</th><th>Nome</th><th>Modo</th><th>Nota</th><th>Acertos</th><th>Tempo</th><th>Resultado</th></tr></thead><tbody>
      ${h.map((x) => `<tr>
        <td>${new Date(x.date).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</td>
        <td>${esc(x.name || "-")}</td>
        <td>${x.mode === "exam" ? "Prova" : "Estudo"}</td>
        <td>${x.pct}%</td>
        <td>${x.correct}/${x.total}</td>
        <td>${fmtTime(x.duration)}</td>
        <td class="${x.pass ? "pass-txt" : "fail-txt"}">${x.pass ? "Aprovado" : "Reprovado"}</td></tr>`).join("")}
      </tbody></table>
      <div class="center"><button id="btn-clear" class="btn">Limpar histórico</button></div>`;
    $("btn-clear").onclick = () => {
      if (confirm("Apagar todo o histórico de tentativas?")) { store.remove(KEY_HISTORY); renderHistory(); }
    };
  }

  function goHome() {
    renderHistory();
    show("home");
  }

  // ---------- eventos ----------
  document.querySelectorAll(".mode-card").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.mode !== "exam") { start(b.dataset.mode); return; }
    $("name-input").value = store.get(KEY_NAME, "");
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

  // ---------- retomada ----------
  const saved = store.get(KEY_STATE, null);
  if (saved && saved.questions) {
    state = saved;
    state.lastSwitch = Date.now(); // tempo com a página fechada não conta para a questão
    if (state.mode === "exam" && Date.now() >= state.deadline) finish(true);
    else enterQuiz();
  } else {
    goHome();
  }
})();
