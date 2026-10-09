// API do Simulado PSPO, hospedada no Neon Functions.
// Toda rota exige login de um e-mail verificado do domínio permitido: o JWT do Neon Auth
// (logo após o código do e-mail) ou a sessão própria emitida por POST /session.
// Rotas /admin/* exigem, além disso, que o e-mail esteja em ADMIN_EMAILS.
import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { Pool } from "pg";
import { attachDatabasePool } from "@neon/functions";
import { SCHEMA_SQL } from "./schema";

const required = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
};
const allowedOrigins = required("ALLOWED_ORIGINS").split(",").map((s) => s.trim()).filter(Boolean);
const allowedDomain = required("ALLOWED_EMAIL_DOMAIN").trim().toLowerCase().replace(/^@/, "");
const adminEmails = new Set(required("ADMIN_EMAILS").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
const jwks = createRemoteJWKSet(new URL(required("NEON_AUTH_JWKS_URL")));
const issuer = new URL(required("NEON_AUTH_BASE_URL")).origin;
const sessionSecret = required("SESSION_SECRET");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
attachDatabasePool(pool);

// Cria/atualiza as tabelas uma vez por isolate (idempotente).
let schemaReady: Promise<unknown> | null = null;
const ensureSchema = () => (schemaReady ??= pool.query(SCHEMA_SQL).catch((e) => { schemaReady = null; throw e; }));

const TOPICS = new Set(["backlog", "po", "events", "value", "release", "fundamentals"]);
const MAX_ATTEMPTS_PER_USER_PER_HOUR = 20;
const MAX_BODY_BYTES = 64 * 1024;

const normName = (s: string) => s.trim().replace(/\s+/g, " ");
const nameKey = (s: string) => normName(s).toLocaleLowerCase("pt-BR");

// ---------- autenticação ----------

// Sessão própria: o cookie do Neon Auth fica em outro domínio e os navegadores o bloqueiam
// como cookie de terceiros, então a sessão se perderia ao recarregar a página.
// Formato: "s1.<payload base64url>.<HMAC-SHA256 base64url>".
const SESSION_DAYS = 30;
const b64url = (buf: Buffer) => buf.toString("base64url");
const sign = (data: string) => createHmac("sha256", sessionSecret).update(data).digest();

function issueSession(sub: string) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const payload = b64url(Buffer.from(JSON.stringify({ sub, exp })));
  return { token: `s1.${payload}.${b64url(sign(payload))}`, exp };
}

function verifySession(token: string): string | null {
  const [v, payload, sig] = token.split(".");
  if (v !== "s1" || !payload || !sig) return null;
  const expected = sign(payload);
  const got = Buffer.from(sig, "base64url");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  try {
    const { sub, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof sub === "string" && exp * 1000 > Date.now() ? sub : null;
  } catch {
    return null;
  }
}

type User = { id: string; email: string; name: string; isAdmin: boolean };
type Env = { Variables: { user: User } };

// Cache curto do usuário por id, para não consultar o banco a cada requisição.
const userCache = new Map<string, { user: User | null; at: number }>();
const USER_CACHE_MS = 60_000;

async function loadUser(id: string): Promise<User | null> {
  const hit = userCache.get(id);
  if (hit && Date.now() - hit.at < USER_CACHE_MS) return hit.user;
  const { rows: [u] } = await pool.query(
    `SELECT id, email, name, "emailVerified" AS verified, coalesce(banned, false) AS banned
       FROM neon_auth."user" WHERE id = $1`, [id]);
  const email = String(u?.email ?? "").toLowerCase();
  const ok = u && u.verified && !u.banned && email.endsWith(`@${allowedDomain}`);
  const user = ok ? { id: u.id, email, name: u.name || "", isAdmin: adminEmails.has(email) } : null;
  userCache.set(id, { user, at: Date.now() });
  return user;
}

const app = new Hono<Env>();

app.use("*", cors({
  origin: (origin) => (allowedOrigins.includes(origin) ? origin : null),
  allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400,
}));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal_error" }, 500);
});

app.get("/", (c) => c.json({ ok: true, service: "simulado-pspo" }));

// Logo após o código do e-mail, o navegador recebe o token da sessão do Neon Auth.
// Ele é validado direto na tabela neon_auth.session (mesmo banco) e trocado pela sessão
// própria de 30 dias, sem depender do cookie de terceiros do Neon.
app.post("/session/exchange", async (c) => {
  const body = await c.req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (token.length < 16 || token.length > 256) return c.json({ error: "unauthorized" }, 401);
  const { rows: [row] } = await pool.query(
    `SELECT "userId" AS user_id FROM neon_auth.session WHERE token = $1 AND "expiresAt" > now()`, [token]);
  if (!row) return c.json({ error: "unauthorized" }, 401);
  const user = await loadUser(row.user_id);
  if (!user) return c.json({ error: "forbidden_domain" }, 403);
  return c.json(issueSession(user.id));
});

// Tudo abaixo exige um token válido de um e-mail permitido.
app.use("*", async (c, next) => {
  if (c.req.method === "OPTIONS" || c.req.path === "/" || c.req.path === "/session/exchange") return next();
  const auth = c.req.header("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return c.json({ error: "unauthorized" }, 401);
  const token = auth.slice(7).trim();
  let sub: string | null | undefined;
  if (token.startsWith("s1.")) {
    sub = verifySession(token);
  } else {
    try {
      const { payload } = await jwtVerify(token, jwks, { issuer });
      sub = payload.sub;
    } catch {
      sub = null;
    }
  }
  if (!sub) return c.json({ error: "unauthorized" }, 401);
  const user = await loadUser(sub);
  if (!user) return c.json({ error: "forbidden_domain" }, 403);
  c.set("user", user);
  await ensureSchema();
  await next();
});

// Troca o login recém-feito (JWT do Neon Auth ou sessão atual) por uma sessão de 30 dias.
app.post("/session", (c) => c.json(issueSession(c.get("user").id)));

app.get("/me", (c) => {
  const u = c.get("user");
  return c.json({ email: u.email, name: u.name, isAdmin: u.isAdmin });
});

// ---------- tentativas ----------

type AnswerIn = {
  id: number; topic: string; answered: boolean; correct: boolean; time: number;
  selected: number[] | null; flagged: boolean;
};
type AttemptIn = {
  name: string; mode: "exam" | "study"; lang: "pt" | "en"; correct: number; total: number;
  duration: number; timeUp: boolean; answers: AnswerIn[];
};

function parseAttempt(body: unknown): AttemptIn | string {
  if (!body || typeof body !== "object") return "invalid body";
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? normName(b.name) : "";
  if (name.length < 1 || name.length > 60) return "invalid name";
  if (b.mode !== "exam" && b.mode !== "study") return "invalid mode";
  if (b.lang !== "pt" && b.lang !== "en") return "invalid lang";
  if (!Array.isArray(b.answers) || b.answers.length < 1 || b.answers.length > 200) return "invalid answers";
  const answers: AnswerIn[] = [];
  const seen = new Set<number>();
  for (const a of b.answers as Record<string, unknown>[]) {
    if (!a || !Number.isInteger(a.id) || (a.id as number) < 0 || (a.id as number) > 100000) return "invalid answer id";
    if (seen.has(a.id as number)) return "duplicate answer id";
    seen.add(a.id as number);
    if (typeof a.topic !== "string" || !TOPICS.has(a.topic)) return "invalid topic";
    const time = Number(a.time);
    let selected: number[] | null = null;
    if (a.selected !== undefined) {
      if (!Array.isArray(a.selected) || a.selected.length > 10 ||
        !a.selected.every((x) => Number.isInteger(x) && x >= 0 && x < 20)) return "invalid selected";
      selected = a.selected as number[];
    }
    answers.push({
      id: a.id as number, topic: a.topic,
      answered: a.answered === true, correct: a.correct === true,
      time: Number.isFinite(time) ? Math.min(Math.max(time, 0), 7200) : 0,
      selected, flagged: a.flagged === true,
    });
  }
  const duration = Number(b.duration);
  if (!Number.isFinite(duration) || duration < 0 || duration > 86400) return "invalid duration";
  // A nota é recalculada a partir das respostas, não confiamos no total enviado.
  const correct = answers.filter((a) => a.correct).length;
  return { name, mode: b.mode, lang: b.lang, correct, total: answers.length, duration: Math.round(duration), timeUp: b.timeUp === true, answers };
}

app.post("/attempts", async (c) => {
  const user = c.get("user");
  const len = Number(c.req.header("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) return c.json({ error: "payload too large" }, 413);
  const raw = await c.req.text();
  if (raw.length > MAX_BODY_BYTES) return c.json({ error: "payload too large" }, 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return c.json({ error: "invalid json" }, 400); }
  const a = parseAttempt(body);
  if (typeof a === "string") return c.json({ error: a }, 400);

  const { rows: [limits] } = await pool.query(
    `SELECT count(*)::int AS n FROM attempts WHERE user_id = $1 AND created_at > now() - interval '1 hour'`, [user.id]);
  if (limits.n >= MAX_ATTEMPTS_PER_USER_PER_HOUR) {
    c.header("Retry-After", "3600");
    return c.json({ error: "too many attempts" }, 429);
  }

  const pct = Math.round((a.correct / a.total) * 1000) / 10;
  const topics: Record<string, { correct: number; total: number }> = {};
  for (const ans of a.answers) {
    topics[ans.topic] ??= { correct: 0, total: 0 };
    topics[ans.topic].total++;
    if (ans.correct) topics[ans.topic].correct++;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [row] } = await client.query(
      `INSERT INTO attempts (user_id, email, name, name_key, mode, lang, correct, total, pct, passed, duration_sec, time_up, topics)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, created_at`,
      [user.id, user.email, a.name, nameKey(a.name), a.mode, a.lang, a.correct, a.total, pct, pct >= 85,
        a.duration, a.timeUp, JSON.stringify(topics)]);
    await client.query(
      `INSERT INTO attempt_answers (attempt_id, question_id, topic, answered, correct, time_sec, selected, flagged, position)
       SELECT $1, q, tp, an, co, ti, sel::smallint[], fl, (ord - 1)::smallint
         FROM unnest($2::int[], $3::text[], $4::bool[], $5::bool[], $6::real[], $7::text[], $8::bool[])
              WITH ORDINALITY AS u(q, tp, an, co, ti, sel, fl, ord)`,
      [row.id, a.answers.map((x) => x.id), a.answers.map((x) => x.topic), a.answers.map((x) => x.answered),
        a.answers.map((x) => x.correct), a.answers.map((x) => x.time),
        // Cada lista vira um literal de array do Postgres ("{1,3}"), porque unnest achataria arrays 2D.
        a.answers.map((x) => (x.selected ? `{${x.selected.join(",")}}` : null)),
        a.answers.map((x) => x.flagged)]);
    await client.query("COMMIT");
    return c.json({ id: row.id, createdAt: row.created_at, pct, passed: pct >= 85 }, 201);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
});

// Melhor nota de cada pessoa no Modo Prova (mostra o nome, nunca o e-mail).
app.get("/ranking", async (c) => {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (user_id) name, pct::float AS pct, correct, total, duration_sec AS duration, lang, created_at AS date,
            count(*) OVER (PARTITION BY user_id)::int AS attempts,
            (user_id = $1) AS me
       FROM attempts WHERE mode = 'exam' AND user_id IS NOT NULL
      ORDER BY user_id, pct DESC, duration_sec ASC, created_at ASC`, [c.get("user").id]);
  rows.sort((x, y) => y.pct - x.pct || x.duration - y.duration);
  return c.json(rows.slice(0, 20));
});

// Histórico da pessoa logada.
app.get("/me/history", async (c) => {
  const { rows } = await pool.query(
    `SELECT id, created_at AS date, name, mode, lang, correct, total, pct::float AS pct, passed AS pass,
            duration_sec AS duration, time_up AS "timeUp", topics
       FROM attempts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, [c.get("user").id]);
  return c.json(rows);
});

// Uma tentativa da pessoa logada, com as respostas, para rever as métricas e a revisão.
app.get("/me/attempts/:id", async (c) => {
  const id = c.req.param("id");
  if (!/^d{1,18}$/.test(id)) return c.json({ error: "invalid id" }, 400);
  const { rows: [a] } = await pool.query(
    `SELECT id, created_at AS date, name, mode, lang, correct, total, pct::float AS pct, passed AS pass,
            duration_sec AS duration, time_up AS "timeUp", topics
       FROM attempts WHERE id = $1 AND user_id = $2`, [id, c.get("user").id]);
  if (!a) return c.json({ error: "not found" }, 404);
  const { rows: answers } = await pool.query(
    `SELECT question_id AS id, topic, answered, correct, time_sec AS time, selected, flagged
       FROM attempt_answers WHERE attempt_id = $1
      ORDER BY position NULLS LAST, question_id`, [id]);
  return c.json({ ...a, answers });
});

// Apaga todas as provas da pessoa logada (histórico na nuvem e ranking).
app.delete("/me/attempts", async (c) => {
  const { rowCount } = await pool.query(`DELETE FROM attempts WHERE user_id = $1`, [c.get("user").id]);
  return c.json({ deleted: rowCount ?? 0 });
});

// ---------- gestor ----------

const requireAdmin = async (c: Context<Env>, next: () => Promise<void>) => {
  if (!c.get("user").isAdmin) return c.json({ error: "forbidden" }, 403);
  await next();
};
app.use("/admin/*", requireAdmin);

app.get("/admin/summary", async (c) => {
  const { rows: [s] } = await pool.query(
    `SELECT count(*)::int AS attempts,
            count(DISTINCT user_id)::int AS people,
            count(*) FILTER (WHERE mode = 'exam')::int AS exams,
            count(*) FILTER (WHERE mode = 'exam' AND passed)::int AS passed,
            coalesce(round(avg(pct) FILTER (WHERE mode = 'exam'), 1), 0)::float AS avg_pct,
            coalesce(round(avg(duration_sec) FILTER (WHERE mode = 'exam')), 0)::int AS avg_duration
       FROM attempts`);
  const { rows: topics } = await pool.query(
    `SELECT a.topic, count(*)::int AS total, count(*) FILTER (WHERE a.correct)::int AS correct
       FROM attempt_answers a JOIN attempts t ON t.id = a.attempt_id
      WHERE t.mode = 'exam' GROUP BY a.topic`);
  return c.json({ ...s, topics });
});

// Apaga uma tentativa específica (ex.: dados de teste).
app.delete("/admin/attempts/:id", async (c) => {
  const id = c.req.param("id");
  if (!/^d{1,18}$/.test(id)) return c.json({ error: "invalid id" }, 400);
  const { rowCount } = await pool.query(`DELETE FROM attempts WHERE id = $1`, [id]);
  return rowCount ? c.json({ deleted: 1 }) : c.json({ error: "not found" }, 404);
});

app.get("/admin/attempts", async (c) => {
  const { rows } = await pool.query(
    `SELECT id, created_at AS date, name, email, mode, lang, correct, total, pct::float AS pct, passed AS pass,
            duration_sec AS duration, time_up AS "timeUp", topics
       FROM attempts ORDER BY created_at DESC LIMIT 1000`);
  return c.json(rows);
});

// Questões que mais derrubam (mínimo de 3 aparições).
app.get("/admin/questions", async (c) => {
  const { rows } = await pool.query(
    `SELECT question_id AS id, topic, count(*)::int AS shown,
            count(*) FILTER (WHERE NOT correct)::int AS wrong,
            round(100.0 * count(*) FILTER (WHERE NOT correct) / count(*), 1)::float AS wrong_pct,
            round(avg(time_sec))::int AS avg_time
       FROM attempt_answers GROUP BY question_id, topic
     HAVING count(*) >= 3
      ORDER BY wrong_pct DESC, shown DESC LIMIT 100`);
  return c.json(rows);
});

export default app;
