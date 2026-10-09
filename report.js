// Relatório individual do painel do gestor: evolução de uma pessoa num período,
// onde melhorou e onde precisa de atenção. Imprimível (Imprimir → Salvar como PDF).
(() => {
  const API_URL = (window.API_URL || "").replace(/\/$/, "");
  const PASS = 85;
  const IDEAL_SEC = 45;
  const TOPICS = window.I18N.pt.topics;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmtTime = (sec) => {
    sec = Math.max(0, Math.round(sec));
    return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
  };
  const fmtDay = (d) => new Date(d).toLocaleDateString("pt-BR");
  const fmtDateTime = (d) => new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  const isoDay = (d) => {
    const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return z.toISOString().slice(0, 10);
  };
  const pctOf = (c, t) => (t ? Math.round((c / t) * 1000) / 10 : 0);
  const sign = (n) => (n > 0 ? `+${n}` : `${n}`);

  async function api(path) {
    const token = await window.Auth.token();
    const res = await fetch(API_URL + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    return res.json();
  }

  // ---------- formulário ----------
  async function loadPeople() {
    const sel = $("rp-person");
    try {
      const people = await api("/admin/people");
      sel.innerHTML = people.length
        ? people.map((p) => `<option value="${esc(p.id)}">${esc(p.name || p.email)} · ${esc(p.email)} (${p.exams} prova${p.exams === 1 ? "" : "s"})</option>`).join("")
        : `<option value="">Ninguém fez provas ainda</option>`;
      $("rp-submit").disabled = !people.length;
    } catch {
      sel.innerHTML = `<option value="">Não foi possível carregar as pessoas</option>`;
    }
  }

  function setDefaultPeriod() {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 29); // últimos 30 dias
    $("rp-from").value = isoDay(from);
    $("rp-to").value = isoDay(to);
  }

  async function generate(e) {
    e?.preventDefault();
    const user = $("rp-person").value;
    const from = $("rp-from").value;
    const to = $("rp-to").value;
    const out = $("report-output");
    if (!user) return;
    if (!from || !to || from > to) {
      out.innerHTML = `<p class="login-error">A data de início precisa ser anterior ou igual à data final.</p>`;
      return;
    }
    out.innerHTML = `<p class="muted small">Gerando relatório…</p>`;
    try {
      const q = new URLSearchParams({ user, from, to, modes: $("rp-modes").value });
      render(await api(`/admin/report?${q}`));
    } catch (err) {
      out.innerHTML = `<p class="login-error">Não foi possível gerar o relatório${err.status ? ` (HTTP ${err.status})` : ""}. Tente de novo.</p>`;
    }
  }

  // ---------- análise ----------
  // Junta acertos por área de uma lista de tentativas.
  function topicTotals(list) {
    const acc = {};
    for (const a of list) {
      for (const [k, v] of Object.entries(a.topics || {})) {
        acc[k] ??= { correct: 0, total: 0 };
        acc[k].correct += v.correct;
        acc[k].total += v.total;
      }
    }
    return acc;
  }

  // Situação de uma área pelo acerto no período (sempre com ícone + rótulo, nunca só cor).
  const status = (p) => (p >= PASS
    ? { cls: "ok", icon: "✓", label: "Dominado" }
    : p >= 70 ? { cls: "warn", icon: "!", label: "Atenção" } : { cls: "bad", icon: "✗", label: "Prioridade" });

  function analyse(data) {
    const list = data.attempts;
    const total = topicTotals(list);
    // Comparação início × fim: primeira metade das tentativas contra a segunda.
    const half = Math.floor(list.length / 2);
    const early = list.length >= 2 ? topicTotals(list.slice(0, half)) : {};
    const late = list.length >= 2 ? topicTotals(list.slice(list.length - half)) : {};
    const areas = Object.keys(TOPICS).filter((k) => total[k]).map((k) => {
      const p = pctOf(total[k].correct, total[k].total);
      const e = early[k] && early[k].total ? pctOf(early[k].correct, early[k].total) : null;
      const l = late[k] && late[k].total ? pctOf(late[k].correct, late[k].total) : null;
      const delta = e !== null && l !== null ? Math.round(l - e) : null;
      // Nível atual: desempenho recente (fim do período); com 1 tentativa, o próprio período.
      const now = l !== null ? Math.round(l) : Math.round(p);
      return { key: k, label: TOPICS[k], ...total[k], pct: p, early: e, late: l, delta, now, st: status(now) };
    });
    const improved = areas.filter((a) => a.delta !== null && a.delta >= 5).sort((a, b) => b.delta - a.delta);
    const attention = areas
      .filter((a) => a.now < PASS || (a.delta !== null && a.delta <= -5))
      .sort((a, b) => a.now - b.now);

    const pcts = list.map((a) => a.pct);
    const totalQuestions = list.reduce((s, a) => s + a.total, 0);
    const totalTime = list.reduce((s, a) => s + a.duration, 0);
    return {
      areas, improved, attention,
      count: list.length,
      exams: list.filter((a) => a.mode === "exam").length,
      avg: pcts.length ? Math.round((pcts.reduce((s, x) => s + x, 0) / pcts.length) * 10) / 10 : 0,
      best: pcts.length ? Math.max(...pcts) : 0,
      last: pcts.length ? pcts[pcts.length - 1] : 0,
      first: pcts.length ? pcts[0] : 0,
      passed: list.filter((a) => a.pass).length,
      timeUps: list.filter((a) => a.timeUp).length,
      secPerQuestion: totalQuestions ? Math.round(totalTime / totalQuestions) : 0,
    };
  }

  // ---------- gráfico de evolução (uma série: nota de cada tentativa) ----------
  function evolutionChart(list) {
    if (!list.length) return "";
    const W = 640, H = 220, L = 40, R = 52, T = 14, B = 30;
    const iw = W - L - R, ih = H - T - B;
    const x = (i) => L + (list.length === 1 ? iw / 2 : (i / (list.length - 1)) * iw);
    const y = (p) => T + ih - (p / 100) * ih;
    const grid = [0, 25, 50, 75, 100].map((v) =>
      `<line x1="${L}" x2="${L + iw}" y1="${y(v)}" y2="${y(v)}" class="rc-grid"/>` +
      `<text x="${L - 8}" y="${y(v) + 4}" class="rc-axis" text-anchor="end">${v}%</text>`).join("");
    const pass = `<line x1="${L}" x2="${L + iw}" y1="${y(PASS)}" y2="${y(PASS)}" class="rc-pass"/>` +
      `<text x="${L + iw + 6}" y="${y(PASS) + 4}" class="rc-axis">${PASS}%</text>`;
    const path = list.map((a, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(a.pct).toFixed(1)}`).join(" ");
    // Rótulos de data: no máximo ~6, sempre a primeira e a última.
    const step = Math.max(1, Math.ceil(list.length / 6));
    const xLabels = list.map((a, i) => (i % step === 0 || i === list.length - 1)
      ? `<text x="${x(i)}" y="${H - 8}" class="rc-axis" text-anchor="middle">${fmtDay(a.date).slice(0, 5)}</text>` : "").join("");
    const points = list.map((a, i) => `
      <g class="rc-pt" data-i="${i}">
        <circle cx="${x(i)}" cy="${y(a.pct)}" r="14" class="rc-hit"/>
        <circle cx="${x(i)}" cy="${y(a.pct)}" r="4.5" class="rc-dot"/>
      </g>`).join("");
    const lastI = list.length - 1;
    const lastLabel = `<text x="${x(lastI) + 8}" y="${y(list[lastI].pct) - 8}" class="rc-value">${list[lastI].pct}%</text>`;
    return `<div class="rc-wrap">
      <svg viewBox="0 0 ${W} ${H}" class="rc-svg" role="img" aria-label="Evolução da nota por tentativa">
        ${grid}${pass}<path d="${path}" class="rc-line"/>${points}${lastLabel}${xLabels}
      </svg>
      <div class="rc-tip hidden" id="rc-tip"></div>
    </div>`;
  }

  function bindChart(list) {
    const wrap = document.querySelector("#report-output .rc-wrap");
    if (!wrap) return;
    const tip = $("rc-tip");
    wrap.querySelectorAll(".rc-pt").forEach((g) => {
      const a = list[Number(g.dataset.i)];
      const showTip = () => {
        const dot = g.querySelector(".rc-dot").getBoundingClientRect();
        const box = wrap.getBoundingClientRect();
        tip.innerHTML = `<strong>${a.pct}%</strong> · ${a.correct}/${a.total}<br>${fmtDateTime(a.date)} · ${a.mode === "exam" ? "Prova" : "Estudo"} ${a.lang.toUpperCase()}<br>${fmtTime(a.duration)}${a.timeUp ? " · tempo esgotado" : ""}`;
        tip.classList.remove("hidden");
        const left = Math.min(Math.max(dot.left - box.left + dot.width / 2, 70), box.width - 70);
        tip.style.left = `${left}px`;
        tip.style.top = `${dot.top - box.top - 10}px`;
        g.classList.add("active");
      };
      const hideTip = () => { tip.classList.add("hidden"); g.classList.remove("active"); };
      g.addEventListener("mouseenter", showTip);
      g.addEventListener("mouseleave", hideTip);
      g.addEventListener("click", showTip);
    });
  }

  // ---------- render ----------
  function render(data) {
    const out = $("report-output");
    const list = data.attempts;
    const p = data.person;
    const periodTxt = `${fmtDay(`${data.from}T12:00:00`)} a ${fmtDay(`${data.to}T12:00:00`)}`;
    const head = `<div class="rp-head">
        <div>
          <h3 class="rp-name">${esc(p.name || p.email)}</h3>
          <p class="muted small">${esc(p.email)} · ${periodTxt} · ${data.modes.length > 1 ? "Prova e Estudo" : "Só Modo Prova"}</p>
        </div>
        <button type="button" class="btn rp-print" id="rp-print">Imprimir / PDF</button>
      </div>`;
    if (!list.length) {
      out.innerHTML = head + `<p class="muted">Nenhuma tentativa neste período. Ajuste as datas ou inclua o Modo Estudo.</p>`;
      $("rp-print").onclick = () => window.print();
      return;
    }
    const s = analyse(data);
    const trend = s.count >= 2 ? Math.round(s.last - s.first) : null;
    const tiles = [
      ["Tentativas", `${s.count}`, s.exams !== s.count ? `${s.exams} no Modo Prova` : ""],
      ["Nota média", `${s.avg}%`, ""],
      ["Melhor nota", `${s.best}%`, ""],
      ["Última nota", `${s.last}%`, trend === null ? "" : `${sign(trend)} pp desde a primeira`],
      ["Aprovações", `${s.passed}/${s.count}`, `mínimo ${PASS}%`],
      ["Ritmo", `${s.secPerQuestion} s`, `por questão · ideal ${IDEAL_SEC} s`],
    ].map(([l, v, sub]) => `<div class="stat"><div class="stat-label">${l}</div><div class="stat-value">${v}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ""}</div>`).join("");

    const cmpNote = s.count >= 2
      ? `"Início" e "Fim" comparam a primeira metade das tentativas do período com a segunda. A situação atual usa o "Fim".`
      : "Com uma só tentativa no período, não há comparação de início e fim.";
    const areaRows = s.areas.map((a) => `<tr>
        <td>${esc(a.label)}</td>
        <td><div class="rp-bar"><div class="bar"><div class="bar-fill" style="width:${a.pct}%;background:var(--${status(a.pct).cls})"></div><div class="bar-mark"></div></div><span class="topic-pct">${a.pct}%</span></div></td>
        <td class="num">${a.correct}/${a.total}</td>
        <td class="num">${a.early === null ? "—" : `${Math.round(a.early)}% → ${Math.round(a.late)}%`}</td>
        <td class="num">${a.delta === null ? "—" : `${a.delta > 0 ? "↑" : a.delta < 0 ? "↓" : "="} ${sign(a.delta)} pp`}</td>
        <td><span class="rp-status ${a.st.cls}">${a.st.icon} ${a.st.label}</span></td>
      </tr>`).join("");

    const li = (arr, fn, empty) => (arr.length ? `<ul class="rp-list">${arr.map(fn).join("")}</ul>` : `<p class="muted small">${empty}</p>`);
    const improvedHtml = li(s.improved,
      (a) => `<li><strong>${esc(a.label)}</strong>: ${Math.round(a.early)}% → ${Math.round(a.late)}% (${sign(a.delta)} pp)</li>`,
      s.count >= 2 ? "Nenhuma área subiu 5 pontos ou mais no período." : "É preciso pelo menos 2 tentativas para comparar.");
    const attentionHtml = li(s.attention,
      (a) => `<li><strong>${esc(a.label)}</strong>: ${a.now}% de acerto ${s.count >= 2 ? "recente" : "no período"}${a.delta !== null && a.delta <= -5 ? ` · caiu ${Math.abs(a.delta)} pp` : a.delta !== null && a.delta >= 5 ? ` · subindo (${sign(a.delta)} pp)` : ""}${a.now < 70 ? " · prioridade" : ""}</li>`,
      "Todas as áreas estão acima de 85%. 🎉");

    // Recomendações automáticas.
    const tips = [];
    const focus = s.attention.slice(0, 2).map((a) => `${a.label} (${a.now}%)`);
    if (focus.length) tips.push(`Concentrar o estudo em <strong>${esc(focus.join(" e "))}</strong>, refazendo as questões erradas abaixo no Modo Estudo.`);
    if (s.improved.length) tips.push(`Manter o ritmo em <strong>${esc(s.improved[0].label)}</strong>, que teve a maior evolução.`);
    if (s.secPerQuestion > IDEAL_SEC) tips.push(`Ritmo de ${s.secPerQuestion} s por questão, acima do ideal de ${IDEAL_SEC} s: treinar no Modo Prova com o tempo correndo.`);
    if (s.timeUps) tips.push(`O tempo acabou em ${s.timeUps} tentativa${s.timeUps > 1 ? "s" : ""}: deixar as questões difíceis para o fim e usar "Marcar para revisar".`);
    if (s.last >= PASS && s.passed >= 2) tips.push("Notas consistentes acima de 85%: a pessoa parece pronta para a prova oficial.");
    else if (s.last >= PASS) tips.push("A última prova passou dos 85%: repetir o Modo Prova para confirmar que o resultado se mantém.");
    else tips.push(`Faltam ${Math.ceil(PASS - s.last)} pontos na última nota para chegar aos ${PASS}%.`);

    const bank = window.QUESTIONS || [];
    const questionsHtml = data.questions.length ? data.questions.map((q) => {
      const b = bank[q.id];
      const right = b ? b.answer.map((i) => b.options[i]).join(" · ") : "";
      return `<div class="review-item">
        <div class="q-meta"><span>#${q.id}</span><span class="tag tag-soft">${esc(TOPICS[q.topic] ?? q.topic)}</span>
          <span class="fail-txt">errou ${q.wrong} de ${q.shown}</span></div>
        <p class="q-text">${b ? esc(b.q) : "Questão não encontrada no banco atual."}</p>
        ${right ? `<div class="exp"><strong>Resposta correta:</strong> ${esc(right)}</div>` : ""}</div>`;
    }).join("") : `<p class="muted small">Nenhuma questão errada no período.</p>`;

    const attemptsRows = list.slice().reverse().map((a) => `<tr>
        <td>${fmtDateTime(a.date)}</td><td>${a.mode === "exam" ? "Prova" : "Estudo"} · ${a.lang.toUpperCase()}</td>
        <td class="num">${a.pct}%</td><td class="num">${a.correct}/${a.total}</td><td class="num">${fmtTime(a.duration)}${a.timeUp ? " ⏱" : ""}</td>
        <td class="${a.pass ? "pass-txt" : "fail-txt"}">${a.pass ? "Aprovado" : "Reprovado"}</td></tr>`).join("");

    out.innerHTML = `${head}
      <div class="stats rp-stats">${tiles}</div>

      <section class="rp-section">
        <h4>Evolução da nota</h4>
        <p class="muted small">Cada ponto é uma tentativa. A linha tracejada é a nota mínima de ${PASS}%. Passe o mouse para ver os detalhes.</p>
        ${evolutionChart(list)}
      </section>

      <section class="rp-section">
        <h4>Desempenho por área</h4>
        <p class="muted small">${cmpNote}</p>
        <div class="table-wrap"><table class="rp-table">
          <thead><tr><th>Área</th><th>Acerto no período</th><th class="num">Acertos</th><th class="num">Início → Fim</th><th class="num">Variação</th><th>Situação atual</th></tr></thead>
          <tbody>${areaRows}</tbody>
        </table></div>
      </section>

      <div class="rp-cols">
        <section class="rp-section rp-good"><h4>✓ Onde melhorou</h4>${improvedHtml}</section>
        <section class="rp-section rp-bad"><h4>! Onde prestar mais atenção</h4>${attentionHtml}</section>
      </div>

      <section class="rp-section">
        <h4>Recomendações</h4>
        <ul class="rp-list">${tips.map((x) => `<li>${x}</li>`).join("")}</ul>
      </section>

      <section class="rp-section">
        <h4>Questões que mais errou</h4>
        ${questionsHtml}
      </section>

      <section class="rp-section">
        <h4>Tentativas no período</h4>
        <div class="table-wrap"><table class="rp-table">
          <thead><tr><th>Data</th><th>Modo</th><th class="num">Nota</th><th class="num">Acertos</th><th class="num">Tempo</th><th>Resultado</th></tr></thead>
          <tbody>${attemptsRows}</tbody>
        </table></div>
      </section>
      <p class="muted small rp-foot">Gerado em ${fmtDateTime(new Date())} · Simulado PSPO I · Zello</p>`;
    bindChart(list);
    $("rp-print").onclick = () => window.print();
  }

  // Chamado pelo admin.js depois que o gestor é autenticado.
  window.Report = {
    init() {
      setDefaultPeriod();
      $("report-form").addEventListener("submit", generate);
      loadPeople();
    },
  };
})();
