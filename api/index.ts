// API do Simulado PSPO, hospedada no Neon Functions.
// Rotas públicas: enviar tentativa, ranking e histórico por nome.
// Rotas /admin/*: exigem o header X-Admin-Key (chave do gestor).
import { timingSafeEqual } from "node:crypto";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { Pool } from "pg";
import { attachDatabasePool } from "@neon/functions";
import { SCHEMA_SQL } from "./schema";

const adminKey = process.env.ADMIN_KEY;
if (!adminKey) throw new Error("ADMIN_KEY is required");
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
attachDatabasePool(pool);

// Cria as tabelas uma vez por isolate (idempotente).
let schemaReady: Promise<unknown> | null = null;
const ensureSchema = () => (schemaReady ??= pool.query(SCHEMA_SQL).catch((e) => { schemaReady = null; throw e; }));

const TOPICS = new Set(["backlog", "po", "events", "value", "release", "fundamentals"]);
const MAX_ATTEMPTS_PER_NAME_PER_HOUR = 20;
const MAX_ATTEMPTS_PER_HOUR = 600; // teto global contra abuso
const MAX_BODY_BYTES = 64 * 1024;

const normName = (s: string) => s.trim().replace(/\s+/g, " ");
const nameKey = (s: string) => normName(s).toLocaleLowerCase("pt-BR");

const app = new Hono();

app.use("*", cors({
  origin: (origin) => (allowedOrigins.includes(origin) ? origin : null),
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "X-Admin-Key"],
  maxAge: 86400,
}));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal_error" }, 500);
});

app.get("/", (c) => c.json({ ok: true, service: "simulado-pspo" }));

// ---------- público ----------

type AnswerIn = { id: number; topic: string; answered: boolean; correct: boolean; time: number };
type AttemptIn = {
  name: string; mode: string; lang: string; correct: number; total: number;
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
    answers.push({
      id: a.id as number, topic: a.topic,
      answered: a.answered === true, correct: a.correct === true,
      time: Number.isFinite(time) ? Math.min(Math.max(time, 0), 7200) : 0,
    });
  }
  const duration = Number(b.duration);
  if (!Number.isFinite(duration) || duration < 0 || duration > 86400) return "invalid duration";
  // A nota é recalculada a partir das respostas, não confiamos no total enviado.
  const correct = answers.filter((a) => a.correct).length;
  return { name, mode: b.mode, lang: b.lang, correct, total: answers.length, duration: Math.round(duration), timeUp: b.timeUp === true, answers };
}

app.post("/attempts", async (c) => {
  const len = Number(c.req.header("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) return c.json({ error: "payload too large" }, 413);
  const raw = await c.req.text();
  if (raw.length > MAX_BODY_BYTES) return c.json({ error: "payload too large" }, 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return c.json({ error: "invalid json" }, 400); }
  const a = parseAttempt(body);
  if (typeof a === "string") return c.json({ error: a }, 400);

  await ensureSchema();
  const key = nameKey(a.name);
  const { rows: [limits] } = await pool.query(
    `SELECT count(*) FILTER (WHERE name_key = $1)::int AS by_name, count(*)::int AS global
       FROM attempts WHERE created_at > now() - interval '1 hour'`, [key]);
  if (limits.by_name >= MAX_ATTEMPTS_PER_NAME_PER_HOUR || limits.global >= MAX_ATTEMPTS_PER_HOUR) {
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
      `INSERT INTO attempts (name, name_key, mode, lang, correct, total, pct, passed, duration_sec, time_up, topics)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, created_at`,
      [a.name, key, a.mode, a.lang, a.correct, a.total, pct, pct >= 85, a.duration, a.timeUp, JSON.stringify(topics)]);
    await client.query(
      `INSERT INTO attempt_answers (attempt_id, question_id, topic, answered, correct, time_sec)
       SELECT $1, * FROM unnest($2::int[], $3::text[], $4::bool[], $5::bool[], $6::real[])`,
      [row.id, a.answers.map((x) => x.id), a.answers.map((x) => x.topic), a.answers.map((x) => x.answered),
        a.answers.map((x) => x.correct), a.answers.map((x) => x.time)]);
    await client.query("COMMIT");
    return c.json({ id: row.id, createdAt: row.created_at, pct, passed: pct >= 85 }, 201);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
});

// Melhor nota de cada pessoa no Modo Prova.
app.get("/ranking", async (c) => {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (name_key) name, pct::float AS pct, correct, total, duration_sec AS duration, lang, created_at AS date,
            count(*) OVER (PARTITION BY name_key)::int AS attempts
       FROM attempts WHERE mode = 'exam'
      ORDER BY name_key, pct DESC, duration_sec ASC, created_at ASC`);
  rows.sort((x, y) => y.pct - x.pct || x.duration - y.duration);
  return c.json(rows.slice(0, 20));
});

// Histórico de uma pessoa (pelo nome).
app.get("/history", async (c) => {
  const name = normName(c.req.query("name") ?? "");
  if (name.length < 1 || name.length > 60) return c.json({ error: "invalid name" }, 400);
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT id, created_at AS date, name, mode, lang, correct, total, pct::float AS pct, passed AS pass,
            duration_sec AS duration, time_up AS "timeUp", topics
       FROM attempts WHERE name_key = $1 ORDER BY created_at DESC LIMIT 50`, [nameKey(name)]);
  return c.json(rows);
});

// ---------- gestor ----------

const expectedKey = Buffer.from(adminKey);
function isAdmin(c: Context) {
  const got = Buffer.from(c.req.header("x-admin-key") ?? "");
  return got.length === expectedKey.length && timingSafeEqual(got, expectedKey);
}
app.use("/admin/*", async (c, next) => {
  if (!isAdmin(c)) return c.json({ error: "unauthorized" }, 401);
  await ensureSchema();
  await next();
});

app.get("/admin/summary", async (c) => {
  const { rows: [s] } = await pool.query(
    `SELECT count(*)::int AS attempts,
            count(DISTINCT name_key)::int AS people,
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

app.get("/admin/attempts", async (c) => {
  const { rows } = await pool.query(
    `SELECT id, created_at AS date, name, mode, lang, correct, total, pct::float AS pct, passed AS pass,
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
