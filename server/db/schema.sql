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

-- Where each roster row stands:
--   joined    a member of the course
--   invited   added by the instructor; the student accepts or rejects (user_id
--             stays NULL until someone signs up with the email)
--   requested the student entered the entry code; the instructor admits or denies
--   denied    the instructor said no; shown to the student once, then deleted
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'joined'
  CHECK (status IN ('joined', 'invited', 'requested', 'denied'));
-- Rows added by email before statuses existed were "pending", i.e. invited.
UPDATE enrollments SET status = 'invited' WHERE user_id IS NULL AND status = 'joined';

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

-- A case in a course. The instructor builds it up (documents, characters,
-- teams, matchups) and publishes each section to students separately; a NULL
-- *_published_at means students can't see that section yet.
CREATE TABLE IF NOT EXISTS cases (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id               uuid        NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  name                    text        NOT NULL,
  created_by              uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  documents_published_at  timestamptz,
  characters_published_at timestamptz,
  teams_published_at      timestamptz
);

CREATE INDEX IF NOT EXISTS cases_course_idx ON cases (course_id);

-- Case documents, stored like fact patterns. `side` limits which students see one.
CREATE TABLE IF NOT EXISTS case_documents (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id      uuid        NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  filename     text        NOT NULL,
  content_type text        NOT NULL,
  size_bytes   integer     NOT NULL,
  data         bytea       NOT NULL,
  side         text        NOT NULL DEFAULT 'both' CHECK (side IN ('plaintiff', 'defendant', 'both')),
  uploaded_by  uuid        REFERENCES users (id) ON DELETE SET NULL,
  uploaded_at  timestamptz NOT NULL DEFAULT now()
);

-- People students will interview (later played by an LLM). `title` is their
-- job title, e.g. "Police Officer"; `role` is what they are in the case.
CREATE TABLE IF NOT EXISTS case_characters (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id    uuid        NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  name       text        NOT NULL,
  title      text        NOT NULL,
  role       text        NOT NULL CHECK (role IN ('witness', 'investigator')),
  side       text        NOT NULL DEFAULT 'both' CHECK (side IN ('plaintiff', 'defendant', 'both')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Which documents each character "knows".
CREATE TABLE IF NOT EXISTS character_documents (
  character_id uuid NOT NULL REFERENCES case_characters (id) ON DELETE CASCADE,
  document_id  uuid NOT NULL REFERENCES case_documents (id) ON DELETE CASCADE,
  PRIMARY KEY (character_id, document_id)
);

CREATE TABLE IF NOT EXISTS teams (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id    uuid        NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  name       text        NOT NULL,
  side       text        NOT NULL CHECK (side IN ('plaintiff', 'defendant')),
  position   integer     NOT NULL DEFAULT 0, -- display order chosen by the instructor
  created_at timestamptz NOT NULL DEFAULT now()
);

-- case_id is repeated here so the database enforces one team per student per case.
CREATE TABLE IF NOT EXISTS team_members (
  team_id uuid NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, user_id),
  UNIQUE (case_id, user_id)
);

-- One plaintiff team against one defendant team. A team can be in more than one
-- matchup, so an instructor can "double up" a team to cover a leftover one.
CREATE TABLE IF NOT EXISTS matchups (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id           uuid        NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  plaintiff_team_id uuid        NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  defendant_team_id uuid        NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  position          integer     NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plaintiff_team_id, defendant_team_id)
);

-- Login sessions, in the format connect-pg-simple expects.
CREATE TABLE IF NOT EXISTS session (
  sid    varchar      PRIMARY KEY,
  sess   json         NOT NULL,
  expire timestamp(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS session_expire_idx ON session (expire);
