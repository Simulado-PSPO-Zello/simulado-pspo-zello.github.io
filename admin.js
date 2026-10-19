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
      const [summary, list, questions] = await Promise.all([api("/admin/summary"), api("/admin/attempts"), api("/admin/questions")]);
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

    const bp = window.EXAM_BLUEPRINT;
    const byTopic = Object.fromEntries(s.topics.map((tp) => [tp.topic, tp]));
    const color = (p) => (p >= PASS_PCT ? "var(--ok)" : p >= 70 ? "var(--warn)" : "var(--bad)");
    const row = (label, correct, total, extra = "") => {
      const p = total ? Math.round((correct / total) * 100) : 0;
      return `<div class="topic-row"><span>${label}</span>
        <div class="bar"><div class="bar-fill" style="width:${p}%;background:${color(p)}"></div><div class="bar-mark"></div></div>
        <span class="topic-pct">${total ? `${correct}/${total} · ${p}%` : "—"}</span></div>${extra}`;
    };
    $("topics").innerHTML = s.topics.length ? bp.areas.map((area) => {
      const perExam = area.topics.reduce((sum, k) => sum + (bp.quota[k] || 0), 0);
      const c = area.topics.reduce((sum, k) => sum + (byTopic[k]?.correct || 0), 0);
      const t = area.topics.reduce((sum, k) => sum + (byTopic[k]?.total || 0), 0);
      const topics = area.topics
        .map((k) => ({ k, ...(byTopic[k] || { correct: 0, total: 0 }) }))
        .sort((a, b) => (a.total ? a.correct / a.total : 1) - (b.total ? b.correct / b.total : 1))
        .map((tp) => row(`${esc(TOPICS[tp.k] ?? tp.k)} <span class="muted small">· ${bp.quota[tp.k] || 0} por prova</span>`, tp.correct, tp.total))
        .join("");
      return `<div class="area-group">
        <div class="area-head">${row(`<strong>${esc(area.label)}</strong><br><span class="muted small">${esc(area.official)} · ${perExam} de 80 questões (${Math.round(perExam / 80 * 100)}%)</span>`, c, t)}</div>
        <div class="area-topics">${topics}</div>
      </div>`;
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
