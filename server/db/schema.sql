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

-- A case the whole class works on, e.g. a rollercoaster incident. Students are
-- paired into teams per case, and each matchup of two teams becomes one "case
-- world" with its own variation of the facts. For now a case is just a shell:
-- its content arrives with the structured fact pattern.
-- `draft` is invisible to students; `active` means the worlds have launched;
-- `closed` is a finished case kept for its pairing history.
CREATE TABLE IF NOT EXISTS cases (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id  uuid        NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  title      text        NOT NULL,
  summary    text        NOT NULL DEFAULT '',
  status     text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cases_course_idx ON cases (course_id);

-- Students paired for one case, usually two (one team of three, or a solo
-- student, when the class is odd). Teams belong to a case, not the course, so
-- the class is re-paired for each case. Which side a team argues is stored on
-- its matchup, not here, so a pair can switch sides between cases.
-- `number` is the label ("Team 3"), unique within the case.
CREATE TABLE IF NOT EXISTS teams (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id    uuid        NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  number     integer     NOT NULL CHECK (number > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, number),
  UNIQUE (id, case_id)
);

-- Members point at roster rows rather than accounts, so students who haven't
-- signed up yet can be paired. Removing a student from the roster takes them
-- off their teams. `case_id` is repeated here so a student can only be on one
-- team per case.
CREATE TABLE IF NOT EXISTS team_members (
  team_id   uuid        NOT NULL,
  case_id   uuid        NOT NULL,
  course_id uuid        NOT NULL,
  email     text        NOT NULL,
  added_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, email),
  UNIQUE (case_id, email),
  FOREIGN KEY (team_id, case_id) REFERENCES teams (id, case_id) ON DELETE CASCADE,
  FOREIGN KEY (course_id, email) REFERENCES enrollments (course_id, email) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS team_members_roster_idx ON team_members (course_id, email);

-- Login sessions, in the format connect-pg-simple expects.
CREATE TABLE IF NOT EXISTS session (
  sid    varchar      PRIMARY KEY,
  sess   json         NOT NULL,
  expire timestamp(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS session_expire_idx ON session (expire);
