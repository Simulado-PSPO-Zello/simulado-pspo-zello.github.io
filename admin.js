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
  const fmtDate = (d) => new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

  let attempts = [];
  let modeFilter = "all";

  async function api(path) {
    const token = await window.Auth.token();
    const res = await fetch(API_URL + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
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
      const [summary, list, questions] = await Promise.all([api("/admin/summary"), api("/admin/attempts"), api("/admin/questions")]);
      attempts = list;
      $("login").classList.add("hidden");
      $("dashboard").classList.remove("hidden");
      $("btn-logout").classList.remove("hidden");
      renderSummary(summary);
      renderAttempts();
      renderQuestions(questions);
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

    const rows = s.topics.map((tp) => ({ ...tp, p: Math.round((tp.correct / tp.total) * 100) })).sort((a, b) => a.p - b.p);
    $("topics").innerHTML = rows.length ? rows.map((tp) => {
      const color = tp.p >= PASS_PCT ? "var(--ok)" : tp.p >= 70 ? "var(--warn)" : "var(--bad)";
      return `<div class="topic-row"><span>${esc(TOPICS[tp.topic] ?? tp.topic)}</span>
        <div class="bar"><div class="bar-fill" style="width:${tp.p}%;background:${color}"></div><div class="bar-mark"></div></div>
        <span class="topic-pct">${tp.correct}/${tp.total} · ${tp.p}%</span></div>`;
    }).join("") : `<p class="muted">Ainda não há provas registradas.</p>`;
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
      <thead><tr><th>Data</th><th>Nome</th><th>E-mail</th><th>Modo</th><th>Nota</th><th>Acertos</th><th>Tempo</th><th>Resultado</th><th>Pior área</th></tr></thead><tbody>
      ${list.map((a) => {
        const worst = Object.entries(a.topics || {})
          .map(([k, v]) => [k, v.correct / v.total]).sort((x, y) => x[1] - y[1])[0];
        return `<tr>
          <td>${fmtDate(a.date)}</td><td>${esc(a.name)}</td><td class="small muted">${esc(a.email || "-")}</td>
          <td>${a.mode === "exam" ? "Prova" : "Estudo"} · ${a.lang.toUpperCase()}</td>
          <td>${a.pct}%</td><td>${a.correct}/${a.total}</td>
          <td>${fmtTime(a.duration)}${a.timeUp ? " ⏱" : ""}</td>
          <td class="${a.pass ? "pass-txt" : "fail-txt"}">${a.pass ? "Aprovado" : "Reprovado"}</td>
          <td class="small muted">${worst ? `${esc(TOPICS[worst[0]] ?? worst[0])} (${Math.round(worst[1] * 100)}%)` : "-"}</td></tr>`;
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
    const head = ["data", "nome", "email", "modo", "idioma", "nota", "acertos", "total", "tempo_seg", "aprovado", ...Object.keys(TOPICS).map((k) => `area_${k}_pct`)];
    const lines = filtered().map((a) => [
      new Date(a.date).toISOString(), a.name, a.email || "", a.mode, a.lang, a.pct, a.correct, a.total, a.duration, a.pass ? "sim" : "nao",
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

  window.Auth.init().then((user) => {
    if (!user) { showLogin(); return; }
    $("admin-email").textContent = user.email;
    load();
  });
})();
