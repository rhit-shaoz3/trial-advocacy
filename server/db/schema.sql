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

-- Course-level fact pattern uploads were replaced by per-case materials
-- (case_materials below). Drop the old table, and its files, if it exists.
DROP TABLE IF EXISTS fact_patterns;

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

-- Two teams of a case set against each other: one "case world". `number` is
-- the label (1 = World A), unique within the case. The world's own content
-- (its variation of the facts, AI witness state) arrives later.
CREATE TABLE IF NOT EXISTS matchups (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id    uuid        NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  number     integer     NOT NULL CHECK (number > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, number),
  UNIQUE (id, case_id)
);

-- Which team argues which side in a matchup. The side lives here rather than
-- on the team so a pair can be plaintiff in one case and defense in the next.
-- A team is in at most one matchup. Deleting a team removes its row here, and
-- the app then deletes the matchup it leaves one-sided.
CREATE TABLE IF NOT EXISTS matchup_teams (
  matchup_id uuid NOT NULL,
  case_id    uuid NOT NULL,
  team_id    uuid NOT NULL UNIQUE,
  side       text NOT NULL CHECK (side IN ('plaintiff', 'defense')),
  -- Deferrable so swapping sides in one UPDATE is checked once, at the end.
  PRIMARY KEY (matchup_id, side) DEFERRABLE,
  FOREIGN KEY (matchup_id, case_id) REFERENCES matchups (id, case_id) ON DELETE CASCADE,
  FOREIGN KEY (team_id, case_id) REFERENCES teams (id, case_id) ON DELETE CASCADE
);

-- A note from the instructor shown on every student's case dashboard.
ALTER TABLE cases ADD COLUMN IF NOT EXISTS instructor_note text NOT NULL DEFAULT '';

-- The case file: the pieces of the fact pattern the instructor uploads
-- (documents, images, audio, video). What kind of file it is comes from its
-- content type. `audience` says which side can see it. The file itself is in
-- object storage (S3 in production) under `storage_key`; `data` only holds
-- files uploaded before that, until `npm run storage:migrate` moves them.
CREATE TABLE IF NOT EXISTS case_materials (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id      uuid        NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  audience     text        NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'plaintiff', 'defense')),
  filename     text        NOT NULL,
  description  text        NOT NULL DEFAULT '',
  content_type text        NOT NULL,
  size_bytes   integer     NOT NULL,
  data         bytea,
  storage_key  text,
  uploaded_by  uuid        REFERENCES users (id) ON DELETE SET NULL,
  uploaded_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE case_materials ADD COLUMN IF NOT EXISTS storage_key text;
ALTER TABLE case_materials ALTER COLUMN data DROP NOT NULL;

CREATE INDEX IF NOT EXISTS case_materials_case_idx ON case_materials (case_id);

-- Materials were briefly split into "fact pattern" and "evidence"; the fact
-- pattern is the whole packet, so that split was dropped.
ALTER TABLE case_materials DROP COLUMN IF EXISTS kind;

-- People in the case's story. For now just a directory; later each will be
-- an AI-simulated witness students can interview.
CREATE TABLE IF NOT EXISTS case_witnesses (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     uuid        NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  name        text        NOT NULL,
  role        text        NOT NULL DEFAULT '',
  description text        NOT NULL DEFAULT '',
  audience    text        NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'plaintiff', 'defense')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS case_witnesses_case_idx ON case_witnesses (case_id);

-- Work the instructor assigns for a case, to every team on `audience`'s side.
CREATE TABLE IF NOT EXISTS case_tasks (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     uuid        NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  title       text        NOT NULL,
  description text        NOT NULL DEFAULT '',
  due_at      timestamptz,
  audience    text        NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'plaintiff', 'defense')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS case_tasks_case_idx ON case_tasks (case_id);

-- A team marking one of its case's tasks done. Either teammate can.
CREATE TABLE IF NOT EXISTS task_completions (
  task_id      uuid        NOT NULL REFERENCES case_tasks (id) ON DELETE CASCADE,
  team_id      uuid        NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  completed_by uuid        REFERENCES users (id) ON DELETE SET NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, team_id)
);

-- AI witnesses --------------------------------------------------------------

-- Case files can also be for instructors only (e.g. a witness's deposition,
-- which trains an AI witness but must never reach students).
ALTER TABLE case_materials DROP CONSTRAINT IF EXISTS case_materials_audience_check;
ALTER TABLE case_materials ADD CONSTRAINT case_materials_audience_check
  CHECK (audience IN ('all', 'plaintiff', 'defense', 'instructor'));

-- A transcription of each file (by Claude, once, after upload) that the AI
-- witnesses read. `text_status`: pending while it runs, ready, failed (with
-- `text_error`), or none for files with nothing to read (audio, video).
ALTER TABLE case_materials ADD COLUMN IF NOT EXISTS text_status text NOT NULL DEFAULT 'pending'
  CHECK (text_status IN ('pending', 'ready', 'failed', 'none'));
ALTER TABLE case_materials ADD COLUMN IF NOT EXISTS text_content text;
ALTER TABLE case_materials ADD COLUMN IF NOT EXISTS text_error text;

-- Case-wide settings for the AI witnesses: "today" inside the case, and the
-- issues no witness may settle.
ALTER TABLE cases ADD COLUMN IF NOT EXISTS in_world_date date;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS disputed_issues text NOT NULL DEFAULT '';

-- Every case world in a case moves through the same phases, when the
-- instructor says so: subpoena (each side sees only its own witnesses),
-- investigate (the background investigator opens), deposition (every witness
-- is revealed to both sides).
ALTER TABLE cases ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'subpoena'
  CHECK (phase IN ('subpoena', 'investigate', 'deposition'));

-- A witness becomes an AI witness once it has a side and a deposition. The
-- deposition is its own sworn account; `known_material_ids` are the other case
-- files the witness has seen. `defending_counsel` is the witness's lawyer, who
-- may object when the other side is asking.
ALTER TABLE case_witnesses ADD COLUMN IF NOT EXISTS aligned_side text CHECK (aligned_side IN ('plaintiff', 'defense'));
ALTER TABLE case_witnesses ADD COLUMN IF NOT EXISTS persona_notes text NOT NULL DEFAULT '';
ALTER TABLE case_witnesses ADD COLUMN IF NOT EXISTS deposition_material_id uuid REFERENCES case_materials (id) ON DELETE SET NULL;
ALTER TABLE case_witnesses ADD COLUMN IF NOT EXISTS known_material_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE case_witnesses ADD COLUMN IF NOT EXISTS defending_counsel text NOT NULL DEFAULT '';

-- One interview of an AI witness, before any deposition: by a team (both
-- partners share it, always as their team's side) or, with no team, an
-- instructor's test run. `side` is who is asking. Starting over ends the
-- current one and opens a new, empty one.
CREATE TABLE IF NOT EXISTS interviews (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  witness_id uuid        NOT NULL REFERENCES case_witnesses (id) ON DELETE CASCADE,
  team_id    uuid        REFERENCES teams (id) ON DELETE CASCADE,
  side       text        NOT NULL CHECK (side IN ('plaintiff', 'defense')),
  started_by uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at   timestamptz
);

CREATE INDEX IF NOT EXISTS interviews_witness_idx ON interviews (witness_id);

-- At most one open interview per witness, team (or instructor test), and side.
CREATE UNIQUE INDEX IF NOT EXISTS interviews_open_idx
  ON interviews (witness_id, COALESCE(team_id, '00000000-0000-0000-0000-000000000000'::uuid), side)
  WHERE ended_at IS NULL;

-- Each question and the witness's reply. `position` orders them; it is unique
-- so two partners asking at once can't both be answered at the same point.
CREATE TABLE IF NOT EXISTS interview_turns (
  interview_id  uuid        NOT NULL REFERENCES interviews (id) ON DELETE CASCADE,
  position      integer     NOT NULL,
  question      text        NOT NULL,
  reply         text        NOT NULL,
  objection     text,
  answer        text        NOT NULL,
  asked_by      uuid        REFERENCES users (id) ON DELETE SET NULL,
  model         text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (interview_id, position)
);

-- Login sessions, in the format connect-pg-simple expects.
CREATE TABLE IF NOT EXISTS session (
  sid    varchar      PRIMARY KEY,
  sess   json         NOT NULL,
  expire timestamp(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS session_expire_idx ON session (expire);
