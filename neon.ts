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
        // Chave do painel do gestor (header X-Admin-Key). Fica só no .env.local.
        ADMIN_KEY: process.env.ADMIN_KEY!,
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
