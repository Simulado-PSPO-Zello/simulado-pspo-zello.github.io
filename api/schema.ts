// Esquema do banco. Idempotente: roda na primeira requisição de cada isolate.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS attempts (
  id            bigserial PRIMARY KEY,
  created_at    timestamptz NOT NULL DEFAULT now(),
  name          text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  name_key      text        NOT NULL,              -- nome normalizado (minúsculo, sem espaços extras)
  mode          text        NOT NULL CHECK (mode IN ('exam', 'study')),
  lang          text        NOT NULL CHECK (lang IN ('pt', 'en')),
  correct       int         NOT NULL CHECK (correct >= 0),
  total         int         NOT NULL CHECK (total BETWEEN 1 AND 200),
  pct           numeric(5,1) NOT NULL CHECK (pct BETWEEN 0 AND 100),
  passed        boolean     NOT NULL,
  duration_sec  int         NOT NULL CHECK (duration_sec >= 0),
  time_up       boolean     NOT NULL DEFAULT false,
  topics        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  CHECK (correct <= total)
);
-- Login (Neon Auth): cada tentativa pertence a um usuário.
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS email text;
CREATE INDEX IF NOT EXISTS attempts_user_idx ON attempts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS attempts_name_key_idx ON attempts (name_key, created_at DESC);
CREATE INDEX IF NOT EXISTS attempts_ranking_idx  ON attempts (mode, pct DESC);
CREATE INDEX IF NOT EXISTS attempts_created_idx  ON attempts (created_at DESC);

CREATE TABLE IF NOT EXISTS attempt_answers (
  attempt_id   bigint  NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id  int     NOT NULL CHECK (question_id >= 0),
  topic        text    NOT NULL,
  answered     boolean NOT NULL,
  correct      boolean NOT NULL,
  time_sec     real    NOT NULL DEFAULT 0,
  PRIMARY KEY (attempt_id, question_id)
);
CREATE INDEX IF NOT EXISTS attempt_answers_question_idx ON attempt_answers (question_id);
-- Detalhe para rever a prova depois: alternativas marcadas (índices originais), marcação e ordem.
ALTER TABLE attempt_answers ADD COLUMN IF NOT EXISTS selected smallint[];
ALTER TABLE attempt_answers ADD COLUMN IF NOT EXISTS flagged boolean NOT NULL DEFAULT false;
ALTER TABLE attempt_answers ADD COLUMN IF NOT EXISTS position smallint;
`;
