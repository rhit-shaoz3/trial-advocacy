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

-- A class is taught by one or more instructors. Students get in either by an
-- instructor's email invitation or by entering the class's join code.
CREATE TABLE IF NOT EXISTS classes (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  join_code  text        NOT NULL UNIQUE,
  created_by uuid        NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS class_instructors (
  class_id uuid NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
  user_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (class_id, user_id)
);

-- The class roster.
CREATE TABLE IF NOT EXISTS class_students (
  class_id  uuid        NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
  user_id   uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (class_id, user_id)
);

-- Instructor -> student invitations. Keyed by email so people can be invited
-- before they have an account. Accepting moves the student into class_students;
-- accepting or rejecting deletes the invitation.
CREATE TABLE IF NOT EXISTS class_invitations (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id   uuid        NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
  email      text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS class_invitations_class_email_key
  ON class_invitations (class_id, lower(email));

-- Student -> instructor requests made with a join code. Admitting moves the
-- student into class_students and deletes the request. Denying keeps the row as
-- 'denied' until the student has seen the notice and dismissed it.
CREATE TABLE IF NOT EXISTS class_join_requests (
  class_id   uuid        NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status     text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'denied')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (class_id, user_id)
);

-- A case belongs to one class. Instructors build it up (documents, characters,
-- teams, matchups) and publish each section to students separately; a NULL
-- *_published_at means students can't see that section yet.
CREATE TABLE IF NOT EXISTS cases (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id                uuid        NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
  name                    text        NOT NULL,
  created_by              uuid        NOT NULL REFERENCES users (id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  documents_published_at  timestamptz,
  characters_published_at timestamptz,
  teams_published_at      timestamptz
);

-- Uploaded file contents. Only server/files/fileStore.ts reads or writes this
-- table, so moving files to S3 later means replacing that one module.
CREATE TABLE IF NOT EXISTS stored_files (
  key        text        PRIMARY KEY,
  content    bytea       NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS case_documents (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id      uuid        NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  filename     text        NOT NULL,
  content_type text        NOT NULL,
  size_bytes   integer     NOT NULL,
  storage_key  text        NOT NULL UNIQUE,
  side         text        NOT NULL DEFAULT 'both' CHECK (side IN ('plaintiff', 'defendant', 'both')),
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
