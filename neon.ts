import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  // Declare your Neon services here
  auth: true,
  functions: {
    // API do simulado: tentativas, ranking, histórico e painel do gestor.
    simulado: {
      name: "simulado pspo api",
      source: "api/index.ts",
      env: {
        // Só e-mails verificados deste domínio podem usar a API.
        ALLOWED_EMAIL_DOMAIN: process.env.ALLOWED_EMAIL_DOMAIN!,
        // Donos do painel (acesso fixo; liberam e removem gestores na tela). Separados por vírgula.
        OWNER_EMAILS: process.env.OWNER_EMAILS!,
        // Assina as sessões de 30 dias emitidas pela API. Fica só no .env.local.
        SESSION_SECRET: process.env.SESSION_SECRET!,
        // Sites que podem chamar a API pelo navegador (CORS), separados por vírgula.
        ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS!,
      },
    },
  },
  // Branch policy: per-branch tuning
  branch: (branch) => {
    if (branch.isDefault) {
      // Default branch: no overrides, uses project defaults
      return {};
    }
    if (!branch.exists) {
      // New non-default branches: auto-expire
      // Run `neon checkout <name>` to create a new branch with these settings
      return { ttl: "7d" };
    }
    // Existing branch: no changes
    return {};
  },
});
