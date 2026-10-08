// Login com código por e-mail (Neon Auth), compartilhado pelo simulado e pelo painel do gestor.
// A restrição de domínio aqui é só para orientar o usuário: quem garante é a API.
//
// Sessão: o cookie do Neon Auth fica no domínio do Neon e os navegadores o bloqueiam como
// cookie de terceiros, então ele não sobrevive a um recarregamento. Por isso, logo após o
// código ser validado, trocamos o JWT do Neon por uma sessão de 30 dias emitida pela nossa
// API (POST /session) e a guardamos no navegador.
(() => {
  const client = window.NeonAuth.createAuthClient(window.NEON_AUTH_URL);
  const domain = String(window.ALLOWED_EMAIL_DOMAIN || "").toLowerCase().replace(/^@/, "");
  const API_URL = (window.API_URL || "").replace(/\/$/, "");
  const KEY_SESSION = "pspo-session";
  let user = null;

  const normEmail = (e) => String(e || "").trim().toLowerCase();
  const isAllowed = (email) => normEmail(email).endsWith(`@${domain}`);

  const session = {
    get() {
      try {
        const s = JSON.parse(localStorage.getItem(KEY_SESSION));
        return s && s.token && s.exp * 1000 > Date.now() + 60_000 ? s : null;
      } catch {
        return null;
      }
    },
    set(s) { try { localStorage.setItem(KEY_SESSION, JSON.stringify(s)); } catch { /* sem storage */ } },
    clear() { try { localStorage.removeItem(KEY_SESSION); } catch { /* sem storage */ } },
  };

  // Junta status, código e mensagem do erro para mostrar e registrar no console.
  const errorMessage = (error) => {
    const parts = [error?.status, error?.code, error?.message || error?.statusText].filter(Boolean);
    const msg = parts.length ? parts.join(" · ") : "unknown_error";
    console.error("[auth]", msg, error);
    return msg;
  };

  // Cria a sessão própria a partir do token da sessão do Neon (validado no banco pela API)
  // ou, como alternativa, de um JWT do Neon. Depois lê os dados da conta.
  async function createSession({ neonSessionToken, jwt }) {
    const res = neonSessionToken
      ? await fetch(`${API_URL}/session/exchange`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: neonSessionToken }),
        })
      : await fetch(`${API_URL}/session`, { method: "POST", headers: { Authorization: `Bearer ${jwt}` } });
    if (!res.ok) return { error: res.status };
    const { token, exp } = await res.json();
    const me = await fetch(`${API_URL}/me`, { headers: { Authorization: `Bearer ${token}` } });
    if (!me.ok) return { error: me.status };
    const info = await me.json();
    session.set({ token, exp, email: info.email, name: info.name, isAdmin: info.isAdmin });
    user = { email: info.email, name: info.name, isAdmin: info.isAdmin };
    return { user };
  }

  window.Auth = {
    domain,
    isAllowed,
    get user() { return user; },

    // Restaura o login: primeiro a sessão própria; se não houver, tenta o cookie do Neon
    // (navegadores que ainda aceitam cookie de terceiros) e converte em sessão própria.
    async init() {
      const s = session.get();
      if (s && isAllowed(s.email)) {
        user = { email: s.email, name: s.name, isAdmin: s.isAdmin };
        return user;
      }
      session.clear();
      user = null;
      try {
        const { data } = await client.getSession();
        if (data?.user && isAllowed(data.user.email)) {
          const { data: t } = await client.token();
          if (t?.token) await createSession({ jwt: t.token });
        }
      } catch {
        user = null;
      }
      return user;
    },

    async sendCode(email) {
      email = normEmail(email);
      if (!isAllowed(email)) return { error: "domain" };
      const { error } = await client.emailOtp.sendVerificationOtp({ email, type: "sign-in" });
      return error ? { error: errorMessage(error) } : {};
    },

    async verifyCode(email, otp) {
      email = normEmail(email);
      const { data, error } = await client.signIn.emailOtp({ email, otp: String(otp).trim() });
      if (error) return { error: errorMessage(error) };
      if (!isAllowed(data?.user?.email)) return { user: data?.user || null };
      // A resposta do login traz o token da sessão do Neon: não depende do cookie de terceiros.
      let r = data?.token ? await createSession({ neonSessionToken: data.token }) : { error: "no session token" };
      if (r.error) {
        // Alternativa: JWT do Neon (funciona quando o navegador aceita o cookie do Neon).
        const { data: t } = await client.token().catch(() => ({ data: null }));
        if (t?.token) r = await createSession({ jwt: t.token });
      }
      return r.error ? { error: errorMessage({ message: `session · ${r.error}` }) } : { user: r.user };
    },

    async signOut() {
      session.clear();
      user = null;
      try { await client.signOut(); } catch { /* sessão do Neon já encerrada */ }
    },

    // Token para chamar a API: a sessão própria (30 dias).
    async token() {
      return session.get()?.token || null;
    },
  };
})();
