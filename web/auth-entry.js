// Ponto de entrada do bundle do Neon Auth para o navegador (gerado em vendor/neon-auth.js).
// Rebuild: npm run build:auth
import { createAuthClient } from "@neondatabase/auth";

window.NeonAuth = { createAuthClient };
