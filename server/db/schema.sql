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

-- A course offering in one term, e.g. LAW 540 in Fall 2026. Students join
-- with the entry code, which is stored uppercase.
CREATE TABLE IF NOT EXISTS courses (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text        NOT NULL,
  title         text        NOT NULL,
  term          text        NOT NULL,
  term_start    date        NOT NULL,
  entry_code    text        NOT NULL UNIQUE,
  instructor_id uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS enrollments (
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  course_id   uuid        NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_id)
);

-- Login sessions, in the format connect-pg-simple expects.
CREATE TABLE IF NOT EXISTS session (
  sid    varchar      PRIMARY KEY,
  sess   json         NOT NULL,
  expire timestamp(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS session_expire_idx ON session (expire);
