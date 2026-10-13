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

CREATE INDEX IF NOT EXISTS courses_instructor_idx ON courses (instructor_id);

-- The course roster, keyed by (lowercase) email so an instructor can add a
-- student before they have an account. `user_id` stays NULL ("pending") until
-- someone signs up with that email or joins with the entry code.
CREATE TABLE IF NOT EXISTS enrollments (
  course_id uuid        NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  email     text        NOT NULL,
  user_id   uuid        REFERENCES users (id) ON DELETE CASCADE,
  added_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (course_id, email)
);

CREATE INDEX IF NOT EXISTS enrollments_user_idx ON enrollments (user_id);
CREATE INDEX IF NOT EXISTS enrollments_pending_email_idx ON enrollments (email) WHERE user_id IS NULL;

-- Course documents. Stored in the database because Heroku's filesystem is
-- wiped on every restart; move to object storage if files get large.
CREATE TABLE IF NOT EXISTS fact_patterns (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id    uuid        NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  filename     text        NOT NULL,
  content_type text        NOT NULL,
  size_bytes   integer     NOT NULL,
  data         bytea       NOT NULL,
  uploaded_by  uuid        REFERENCES users (id) ON DELETE SET NULL,
  uploaded_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fact_patterns_course_idx ON fact_patterns (course_id);

-- Login sessions, in the format connect-pg-simple expects.
CREATE TABLE IF NOT EXISTS session (
  sid    varchar      PRIMARY KEY,
  sess   json         NOT NULL,
  expire timestamp(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS session_expire_idx ON session (expire);
