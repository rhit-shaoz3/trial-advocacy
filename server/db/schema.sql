-- Idempotent schema. Applied by `npm run db:migrate` (and Heroku's release phase).

CREATE TABLE IF NOT EXISTS users (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text        NOT NULL,
  email         text        NOT NULL,
  role          text        NOT NULL CHECK (role IN ('student', 'instructor')),
  password_hash text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));

-- Login sessions, in the format connect-pg-simple expects.
CREATE TABLE IF NOT EXISTS session (
  sid    varchar      PRIMARY KEY,
  sess   json         NOT NULL,
  expire timestamp(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS session_expire_idx ON session (expire);
