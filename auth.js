// Login com código por e-mail (Neon Auth), compartilhado pelo simulado e pelo painel do gestor.
// A restrição de domínio aqui é só para orientar o usuário: quem garante é a API.
(() => {
  const client = window.NeonAuth.createAuthClient(window.NEON_AUTH_URL);
  const domain = String(window.ALLOWED_EMAIL_DOMAIN || "").toLowerCase().replace(/^@/, "");
  let user = null;
  let cachedToken = null; // { value, exp }

  const normEmail = (e) => String(e || "").trim().toLowerCase();
  const isAllowed = (email) => normEmail(email).endsWith(`@${domain}`);

  // Lê o "exp" do JWT só para saber quando renovar (a validação de verdade é na API).
  const jwtExp = (token) => {
    try {
      const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return (payload.exp || 0) * 1000;
    } catch {
      return 0;
    }
  };

  const errorMessage = (error) => error?.message || error?.code || "unknown_error";

  window.Auth = {
    domain,
    isAllowed,
    get user() { return user; },

    // Restaura a sessão salva pelo navegador (após recarregar a página).
    async init() {
      try {
        const { data } = await client.getSession();
        user = data?.user && isAllowed(data.user.email) ? data.user : null;
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
      user = data?.user || (await this.init());
      cachedToken = null;
      return { user };
    },

    async signOut() {
      cachedToken = null;
      user = null;
      try { await client.signOut(); } catch { /* sessão já encerrada */ }
    },

    // JWT de curta duração para chamar a API. Renova um minuto antes de expirar.
    async token() {
      if (cachedToken && cachedToken.exp - Date.now() > 60_000) return cachedToken.value;
      const { data, error } = await client.token();
      if (error || !data?.token) return null;
      cachedToken = { value: data.token, exp: jwtExp(data.token) };
      return cachedToken.value;
    },
  };
})();
