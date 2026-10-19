(() => {
  const API_URL = (window.API_URL || "").replace(/\/$/, "");
  const PASS_PCT = 85;
  const TOPICS = window.I18N.pt.topics;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmtTime = (sec) => {
    sec = Math.max(0, Math.round(sec));
    return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
  };
  // Data · início → término (início = término − duração).
  const fmtRange = (endIso, durationSec) => {
    const end = new Date(endIso);
    const start = new Date(end.getTime() - (Number(durationSec) || 0) * 1000);
    const hm = (d) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const day = (d) => d.toLocaleDateString("pt-BR");
    return `${day(end)} · ${day(start) === day(end) ? "" : `${day(start)} `}${hm(start)} → ${hm(end)}`;
  };
  const fmtDate = (d) => new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

  let attempts = [];
  let modeFilter = "all";
  let reportReady = false;

  async function api(path, options = {}) {
    const token = await window.Auth.token();
    const res = await fetch(API_URL + path, { ...options, headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error("unauthorized"), { status: res.status });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function showLogin(message) {
    $("login").classList.remove("hidden");
    $("dashboard").classList.add("hidden");
    $("btn-logout").classList.add("hidden");
    if (message) $("login-msg").textContent = message;
  }

  async function load() {
    try {
      const [summary, list, questions, people] = await Promise.all([api("/admin/summary"), api("/admin/attempts"), api("/admin/questions"), api("/admin/people")]);
      fillPerfPeople(people);
      attempts = list;
      $("login").classList.add("hidden");
      $("dashboard").classList.remove("hidden");
      $("btn-logout").classList.remove("hidden");
      renderSummary(summary);
      renderAttempts();
      renderQuestions(questions);
      if (!reportReady) { reportReady = true; window.Report.init(); }
    } catch (e) {
      if (e.status === 403) showLogin(`A conta ${window.Auth.user?.email ?? ""} não tem acesso ao painel do gestor.`);
      else if (e.status === 401) showLogin("Sua sessão expirou. Entre de novo pelo simulado.");
      else showLogin("Não foi possível falar com o servidor. Tente de novo em instantes.");
    }
  }

  function renderSummary(s) {
    const passRate = s.exams ? Math.round((s.passed / s.exams) * 100) : 0;
    $("summary").innerHTML = [
      ["Pessoas", s.people],
      ["Provas realizadas", s.exams],
      ["Taxa de aprovação", `${passRate}%`],
      ["Nota média", `${s.avg_pct}%`],
      ["Tempo médio de prova", fmtTime(s.avg_duration)],
      ["Tentativas (total)", s.attempts],
    ].map(([l, v]) => `<div class="stat"><div class="stat-label">${l}</div><div class="stat-value">${v}</div></div>`).join("");

    allPerf = { topics: s.topics, exams: s.exams, who: "Média do time", avgPct: s.avg_pct };
    if (!$("perf-person").value) renderPerf(allPerf);
  }

  // ---------- desempenho normalizado para uma prova de 80 ----------
  let allPerf = null;

  function fillPerfPeople(people) {
    const sel = $("perf-person");
    const current = sel.value;
    sel.innerHTML = `<option value="">Todas as pessoas</option>` + people
      .filter((p) => p.exams > 0)
      .map((p) => `<option value="${esc(p.id)}">${esc(p.name || p.email)} · ${p.exams} prova${p.exams === 1 ? "" : "s"}</option>`).join("");
    sel.value = current;
  }

  // Junta as provas de uma pessoa (todas as datas, só Modo Prova) e normaliza para 80.
  async function showPersonPerf() {
    const user = $("perf-person").value;
    if (!user) { renderPerf(allPerf); return; }
    $("topics").innerHTML = `<p class="muted small">Carregando…</p>`;
    try {
      const to = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      const q = new URLSearchParams({ user, from: "2000-01-01", to, modes: "exam" });
      const data = await api(`/admin/report?${q}`);
      const acc = {};
      for (const a of data.attempts) {
        for (const [k, v] of Object.entries(a.topics || {})) {
          acc[k] ??= { topic: k, correct: 0, total: 0 };
          acc[k].correct += v.correct;
          acc[k].total += v.total;
        }
      }
      const avgPct = data.attempts.length
        ? Math.round((data.attempts.reduce((n, a) => n + a.pct, 0) / data.attempts.length) * 10) / 10 : null;
      renderPerf({ topics: Object.values(acc), exams: data.attempts.length, who: data.person.name || data.person.email, avgPct });
    } catch {
      $("topics").innerHTML = `<p class="login-error">Não foi possível carregar o desempenho dessa pessoa. Tente de novo.</p>`;
    }
  }

  function renderPerf(s) {
    // Duas tabelas que fecham em 80 cada uma, sem contar nada duas vezes:
    //  - por tema: 6 linhas (somam 80 questões);
    //  - por competência: 3 linhas (somam 80 questões).
    // "Acertos por prova" = % de acerto do tema (todas as provas) × questões que ele tem por prova.
    // Competência e prova inteira são a SOMA dos temas, então as contas batem.
    const bp = window.EXAM_BLUEPRINT;
    const byTopic = Object.fromEntries(s.topics.map((tp) => [tp.topic, tp]));
    const fmt1 = (n) => (Math.round(n * 10) / 10).toLocaleString("pt-BR");
    const situation = (p) => (p >= PASS_PCT
      ? `<span class="rp-status ok">✓ Dominado</span>`
      : p >= 70 ? `<span class="rp-status warn">! Atenção</span>` : `<span class="rp-status bad">✗ Prioridade</span>`);
    const accCell = (p) => {
      const color = p >= PASS_PCT ? "var(--ok)" : p >= 70 ? "var(--warn)" : "var(--bad)";
      return `<div class="pa-acc"><div class="bar"><div class="bar-fill" style="width:${p}%;background:${color}"></div><div class="bar-mark"></div></div><strong>${Math.round(p)}%</strong></div>`;
    };
    // Média de acertos por prova de cada tema (null quando ainda não há dados do tema).
    const topicAvg = Object.fromEntries(Object.keys(bp.quota).map((k) => {
      const tp = byTopic[k];
      return [k, tp && tp.total ? (tp.correct / tp.total) * bp.quota[k] : null];
    }));
    const row = (cls, cells, q, avg) => {
      if (avg === null) return `<tr class="${cls}">${cells}<td class="num">${q}</td><td class="num muted">—</td><td class="num muted">—</td><td></td></tr>`;
      const p = (avg / q) * 100;
      return `<tr class="${cls}">${cells}<td class="num">${q}</td><td class="num">${accCell(p)}</td>
        <td class="num"><strong>${fmt1(avg)}</strong> de ${q}</td><td>${situation(p)}</td></tr>`;
    };
    const sum = (keys) => {
      const vals = keys.map((k) => topicAvg[k]).filter((v) => v !== null);
      return vals.length === keys.length ? vals.reduce((a, b) => a + b, 0) : null;
    };
    const allKeys = bp.areas.flatMap((a) => a.topics);
    const total = row("pa-total", `<td colspan="2"><strong>Projeção numa prova atual</strong><div class="pa-sub">soma dos temas acima</div></td>`, 80, sum(allKeys));

    const topicRows = bp.areas.flatMap((area) => area.topics.map((k) =>
      row("", `<td>${esc(TOPICS[k] ?? k)}</td><td class="muted small">${esc(area.label)}</td>`, bp.quota[k], topicAvg[k]))).join("");
    const areaRows = bp.areas.map((area) => row("",
      `<td><strong>${esc(area.label)}</strong><div class="pa-sub">${esc(area.official)}</div></td>
       <td class="muted small">${area.topics.map((k) => esc(TOPICS[k] ?? k)).join(" + ")}</td>`,
      area.topics.reduce((n, k) => n + bp.quota[k], 0), sum(area.topics))).join("");
    const head = (first, second) => `<thead><tr><th>${first}</th><th>${second}</th><th class="num">Questões por prova</th><th class="num">Acerto</th><th class="num">Acertos por prova</th><th>Situação</th></tr></thead>`;
    const answered = s.topics.reduce((n, tp) => n + tp.total, 0);

    // Veredito: a mesma conta da linha "Projeção numa prova atual" (soma dos temas), contra o mínimo de 85%.
    const avgLine = () => s.avgPct === null || s.avgPct === undefined ? "" :
      `<div class="pv-compare"><span><strong>Projeção na prova atual:</strong> ${fmt1(expected ?? 0)} de 80 (${fmt1(((expected ?? 0) / 80) * 100)}%) — acerto de cada tema aplicado à distribuição atual de 80 questões.</span>
        <span><strong>Nota média das provas feitas:</strong> ${fmt1(s.avgPct)}% — média simples das notas de cada prova (soma das notas ÷ ${s.exams}).</span>
        <span class="pv-base">Os dois diferem quando as provas antigas tinham outra quantidade de questões por tema; nas provas novas eles se aproximam.</span></div>`;
    const need = Math.ceil(80 * PASS_PCT / 100); // 68 acertos
    const expected = sum(allKeys);
    const weak = allKeys
      .filter((k) => topicAvg[k] !== null && (topicAvg[k] / bp.quota[k]) * 100 < PASS_PCT)
      .map((k) => ({ k, lost: bp.quota[k] - topicAvg[k], p: Math.round((topicAvg[k] / bp.quota[k]) * 100) }))
      .sort((a, b) => b.lost - a.lost)
      .slice(0, 3);
    const weakTxt = weak.length
      ? `<div class="pv-weak">Onde perde mais pontos: ${weak.map((w) => `<strong>${esc(TOPICS[w.k] ?? w.k)}</strong> (${w.p}%, perde ≈ ${fmt1(w.lost)} por prova)`).join(" · ")}</div>`
      : `<div class="pv-weak">Todos os temas estão acima de ${PASS_PCT}%.</div>`;
    const few = s.exams < 3 ? ` Base pequena: o resultado fica mais confiável a partir de 3 provas.` : "";
    const verdict = expected === null ? "" : expected >= need
      ? `<div class="pv pv-ok"><div class="pv-title">✓ ${esc(s.who)}: atinge a nota de aprovação</div>
          <div>Projeção: <strong>${fmt1(expected)} de 80</strong>, acima dos ${need} acertos necessários (${PASS_PCT}%).</div>${weakTxt}${avgLine()}
          <div class="pv-base">Base: ${s.exams} prova${s.exams === 1 ? "" : "s"} no Modo Prova.${few}</div></div>`
      : `<div class="pv pv-bad"><div class="pv-title">✗ ${esc(s.who)}: ainda não atinge a nota de aprovação</div>
          <div>Projeção: <strong>${fmt1(expected)} de 80</strong>. Faltam <strong>≈ ${fmt1(need - expected)} acertos</strong> para chegar aos ${need} (${PASS_PCT}%).</div>${weakTxt}${avgLine()}
          <div class="pv-base">Base: ${s.exams} prova${s.exams === 1 ? "" : "s"} no Modo Prova.${few}</div></div>`;

    $("topics").innerHTML = s.topics.length ? `${verdict}
      <h3 class="pa-title">Por tema</h3>
      <div class="table-wrap"><table class="rp-table pa-table">${head("Tema", "Competência")}<tbody>${topicRows}${total}</tbody></table></div>
      <h3 class="pa-title">Por competência</h3>
      <div class="table-wrap"><table class="rp-table pa-table">${head("Competência", "Temas")}<tbody>${areaRows}${total}</tbody></table></div>
      <p class="muted small">Tudo reduzido a uma prova de 80 questões, não importa quantas provas foram feitas. "Acerto" é o % de acerto do tema somando as provas (${s.exams} prova${s.exams === 1 ? "" : "s"}, ${answered} questões respondidas); "Acertos por prova" aplica esse % às questões que o tema tem em cada prova. A competência e a prova inteira somam os temas.</p>`
      : `<p class="muted">Ainda não há provas registradas${s.who && s.who !== "Média do time" ? " para essa pessoa" : ""}.</p>`;
  }

  function filtered() {
    const q = $("filter-name").value.trim().toLocaleLowerCase("pt-BR");
    return attempts.filter((a) =>
      (!q || a.name.toLocaleLowerCase("pt-BR").includes(q) || (a.email || "").includes(q)) &&
      (modeFilter === "all" || (modeFilter === "exam" && a.mode === "exam") || (modeFilter === "passed" && a.pass)));
  }

  function renderAttempts() {
    const list = filtered();
    $("attempts").innerHTML = list.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Data e horário</th><th>Nome</th><th>E-mail</th><th>Modo</th><th>Nota</th><th>Acertos</th><th>Tempo</th><th>Resultado</th><th>Pior área</th><th></th></tr></thead><tbody>
      ${list.map((a) => {
        const worst = Object.entries(a.topics || {})
          .map(([k, v]) => [k, v.correct / v.total]).sort((x, y) => x[1] - y[1])[0];
        return `<tr>
          <td class="nowrap">${fmtRange(a.date, a.duration)}</td><td>${esc(a.name)}</td><td class="small muted">${esc(a.email || "-")}</td>
          <td>${a.mode === "exam" ? "Prova" : "Estudo"} · ${a.lang.toUpperCase()}</td>
          <td>${a.pct}%</td><td>${a.correct}/${a.total}</td>
          <td>${fmtTime(a.duration)}${a.timeUp ? " ⏱" : ""}</td>
          <td class="${a.pass ? "pass-txt" : "fail-txt"}">${a.pass ? "Aprovado" : "Reprovado"}</td>
          <td class="small muted">${worst ? `${esc(TOPICS[worst[0]] ?? worst[0])} (${Math.round(worst[1] * 100)}%)` : "-"}</td>
          <td><button type="button" class="btn btn-danger btn-small" data-delete="${a.id}">Apagar</button></td></tr>`;
      }).join("")}
      </tbody></table></div>` : `<p class="muted">Nenhuma tentativa encontrada.</p>`;
  }

  function renderQuestions(rows) {
    const bank = window.QUESTIONS || [];
    $("questions").innerHTML = rows.length ? rows.map((r) => {
      const q = bank[r.id];
      const right = q ? q.answer.map((i) => q.options[i]).join(" · ") : "";
      return `<div class="review-item">
        <div class="q-meta"><span>#${r.id}</span>
          <span class="tag tag-soft">${esc(TOPICS[r.topic] ?? r.topic)}</span>
          <span class="fail-txt">${r.wrong_pct}% de erro</span>
          <span class="muted small">${r.wrong}/${r.shown} erros · ${r.avg_time} s em média</span></div>
        <p class="q-text">${q ? esc(q.q) : "Questão não encontrada no banco atual."}</p>
        ${right ? `<div class="exp"><strong>Resposta correta:</strong> ${esc(right)}</div>` : ""}</div>`;
    }).join("") : `<p class="muted">Ainda não há dados suficientes.</p>`;
  }

  function exportCsv() {
    const cell = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const head = ["inicio", "termino", "nome", "email", "modo", "idioma", "nota", "acertos", "total", "tempo_seg", "aprovado", ...Object.keys(TOPICS).map((k) => `area_${k}_pct`)];
    const lines = filtered().map((a) => [
      new Date(new Date(a.date).getTime() - a.duration * 1000).toISOString(), new Date(a.date).toISOString(), a.name, a.email || "", a.mode, a.lang, a.pct, a.correct, a.total, a.duration, a.pass ? "sim" : "nao",
      ...Object.keys(TOPICS).map((k) => (a.topics?.[k] ? Math.round((a.topics[k].correct / a.topics[k].total) * 100) : "")),
    ].map(cell).join(";"));
    const blob = new Blob(["﻿" + [head.map(cell).join(";"), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `simulado-pspo-tentativas-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  $("btn-logout").addEventListener("click", async () => { await window.Auth.signOut(); location.href = "index.html"; });
  $("filter-name").addEventListener("input", renderAttempts);
  document.querySelectorAll(".chip[data-mode]").forEach((c) => c.addEventListener("click", () => {
    modeFilter = c.dataset.mode;
    document.querySelectorAll(".chip[data-mode]").forEach((x) => x.classList.toggle("active", x === c));
    renderAttempts();
  }));
  $("btn-csv").addEventListener("click", exportCsv);
  $("perf-person").addEventListener("change", showPersonPerf);

  // Apagar tentativa (janela própria: alguns navegadores bloqueiam o confirm()).
  let pendingDelete = null;
  $("attempts").addEventListener("click", (e) => {
    const b = e.target.closest("[data-delete]");
    if (!b) return;
    const a = attempts.find((x) => String(x.id) === b.dataset.delete);
    if (!a) return;
    pendingDelete = a;
    $("delete-text").textContent = `${a.name} (${a.email || "sem e-mail"}) · ${fmtRange(a.date, a.duration)} · ${a.pct}%. Isso não pode ser desfeito.`;
    $("delete-dialog").showModal();
  });
  $("delete-no").addEventListener("click", () => { pendingDelete = null; $("delete-dialog").close(); });
  $("delete-yes").addEventListener("click", async () => {
    if (!pendingDelete) return;
    $("delete-yes").disabled = true;
    try {
      await api(`/admin/attempts/${pendingDelete.id}`, { method: "DELETE" });
      $("delete-dialog").close();
      pendingDelete = null;
      load();
    } catch {
      $("delete-text").textContent = "Não foi possível apagar agora. Tente de novo.";
    } finally {
      $("delete-yes").disabled = false;
    }
  });

  window.Auth.init().then((user) => (user ? window.Auth.refresh() : null)).then((user) => {
    if (!user) { showLogin(); return; }
    $("admin-email").textContent = user.email;
    load();
  });
})();
