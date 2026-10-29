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

-- The colour theme the user picked on the account page (light/dark follows
-- their computer and isn't stored).
ALTER TABLE users ADD COLUMN IF NOT EXISTS theme text NOT NULL DEFAULT 'navy';
-- The theme list changed: Stone became Earth, and Vivid became High contrast.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_theme_check;
UPDATE users SET theme = CASE theme WHEN 'stone' THEN 'earth' WHEN 'vivid' THEN 'contrast' ELSE theme END
  WHERE theme IN ('stone', 'vivid');
ALTER TABLE users ADD CONSTRAINT users_theme_check
  CHECK (theme IN ('navy', 'slate', 'earth', 'vibrant', 'forest', 'lagoon', 'contrast', 'radioactive'));

-- The user's profile picture in file storage (avatars/<userId>/<uuid>), or
-- null to show their initials.
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_key text;

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

-- The most important facts for each side, set by the instructor. The AI
-- witnesses never contradict them; students never see them.
ALTER TABLE cases ADD COLUMN IF NOT EXISTS plaintiff_key_facts text[] NOT NULL DEFAULT '{}';
ALTER TABLE cases ADD COLUMN IF NOT EXISTS defense_key_facts text[] NOT NULL DEFAULT '{}';

-- The one case file every team starts from (e.g. the complaint and pretrial
-- order), shown on their Overview. It's always shared with everyone; the rest
-- of the case file stays with the instructor until teams ask for it.
ALTER TABLE case_materials ADD COLUMN IF NOT EXISTS initial boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS case_materials_initial_idx ON case_materials (case_id) WHERE initial;

-- Every case world in a case moves through the same phases, when the
-- instructor says so: subpoena (each side sees only its own witnesses),
-- investigate (the background investigator opens), deposition (every witness
-- is revealed to both sides).
-- The guided setup a new case goes through: the furthest step the instructor
-- has reached, and when they finished (null until then). Cases made before
-- the guided setup count as finished: the column's first default fills them
-- in, then new cases start unfinished.
ALTER TABLE cases ADD COLUMN IF NOT EXISTS setup_completed_at timestamptz DEFAULT now();
ALTER TABLE cases ALTER COLUMN setup_completed_at DROP DEFAULT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS setup_step text NOT NULL DEFAULT 'details';
-- The setup gained the investigator step.
ALTER TABLE cases DROP CONSTRAINT IF EXISTS cases_setup_step_check;
ALTER TABLE cases ADD CONSTRAINT cases_setup_step_check
  CHECK (setup_step IN ('details', 'facts', 'files', 'teams', 'worlds', 'witnesses', 'investigator', 'tasks'));

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
-- The witness's picture: one of the designs in public/witness-avatars/
-- (1-12), or an uploaded picture in file storage (witnesses/<id>/<uuid>).
-- Choosing one clears the other; with neither, the witness shows an icon.
ALTER TABLE case_witnesses ADD COLUMN IF NOT EXISTS avatar_preset smallint CHECK (avatar_preset BETWEEN 1 AND 12);
ALTER TABLE case_witnesses ADD COLUMN IF NOT EXISTS avatar_key text;

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

-- A team's ended interview, sent to the instructor as the new facts the AI
-- witness added (not in the case files or earlier rulings). The instructor
-- rules on each fact; once the review is completed the rulings bind every
-- later interview: for the team's case world, or for the whole case.
CREATE TABLE IF NOT EXISTS interview_reviews (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id uuid        NOT NULL UNIQUE REFERENCES interviews (id) ON DELETE CASCADE,
  case_id      uuid        NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  witness_id   uuid        NOT NULL REFERENCES case_witnesses (id) ON DELETE CASCADE,
  team_id      uuid        REFERENCES teams (id) ON DELETE SET NULL,
  matchup_id   uuid        REFERENCES matchups (id) ON DELETE SET NULL,
  -- Kept for display even if the teams or worlds are rearranged later.
  team_number  integer     NOT NULL,
  world_number integer     NOT NULL,
  side         text        NOT NULL CHECK (side IN ('plaintiff', 'defense')),
  status       text        NOT NULL DEFAULT 'summarizing'
               CHECK (status IN ('summarizing', 'failed', 'open', 'completed')),
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  completed_by uuid        REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS interview_reviews_case_idx ON interview_reviews (case_id);

-- Each new fact from a review, and the instructor's ruling: accept or deny,
-- for the team's world only or for every world in the case.
CREATE TABLE IF NOT EXISTS review_facts (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id  uuid        NOT NULL REFERENCES interview_reviews (id) ON DELETE CASCADE,
  position   integer     NOT NULL,
  text       text        NOT NULL,
  decision   text        CHECK (decision IN ('accept_world', 'deny_world', 'accept_case', 'deny_case')),
  decided_at timestamptz,
  UNIQUE (review_id, position)
);

-- Which exchanges of the interview stated each fact, and which later ones
-- built on it ({ producedBy: [turn], builtOn: [{ turn, answer }] }), so a
-- denied fact's exchanges can be struck out of the team's transcript. Null
-- for reviews from before this, and for investigator facts.
ALTER TABLE review_facts ADD COLUMN IF NOT EXISTS links jsonb;

-- Which students have opened a completed review's results.
CREATE TABLE IF NOT EXISTS review_seen (
  review_id uuid        NOT NULL REFERENCES interview_reviews (id) ON DELETE CASCADE,
  user_id   uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  seen_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (review_id, user_id)
);

-- Background investigator ----------------------------------------------------

-- Whether the case has a background investigator (and so an investigate
-- phase), what he's called, and the instructor's extra instructions for him.
-- Cases made before the investigator keep him.
ALTER TABLE cases ADD COLUMN IF NOT EXISTS investigator_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS investigator_name text NOT NULL DEFAULT 'John Hastings';
ALTER TABLE cases ADD COLUMN IF NOT EXISTS investigator_instructions text NOT NULL DEFAULT '';

-- The parties, as the instructor names them ("Paige Winston", "Thrillville Parks"); students see
-- their side as "Paige Winston (Plaintiff)". Cases from before are named from an "X v. Y" title.
ALTER TABLE cases ADD COLUMN IF NOT EXISTS plaintiff_name text NOT NULL DEFAULT '';
ALTER TABLE cases ADD COLUMN IF NOT EXISTS defendant_name text NOT NULL DEFAULT '';
UPDATE cases
   SET plaintiff_name = trim(substring(title from '^(.*?)\s+[vV]\.?\s+')),
       defendant_name = trim(regexp_replace(title, '^.*?\s+[vV]\.?\s+', ''))
 WHERE plaintiff_name = '' AND defendant_name = '' AND title ~ '\s[vV]\.?\s';

-- Reviews also cover a team's investigator requests (kind 'investigation'):
-- the assignment the team emailed, the investigator's report, and the clean
-- report the team gets once the instructor has ruled. 'finalizing' is the AI
-- writing that clean report.
ALTER TABLE interview_reviews ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'interview'
  CHECK (kind IN ('interview', 'investigation'));
ALTER TABLE interview_reviews ALTER COLUMN interview_id DROP NOT NULL;
ALTER TABLE interview_reviews ALTER COLUMN witness_id DROP NOT NULL;
ALTER TABLE interview_reviews ADD COLUMN IF NOT EXISTS assignment text;
ALTER TABLE interview_reviews ADD COLUMN IF NOT EXISTS asked_by uuid REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE interview_reviews ADD COLUMN IF NOT EXISTS report text;
ALTER TABLE interview_reviews ADD COLUMN IF NOT EXISTS final_report text;
ALTER TABLE interview_reviews ADD COLUMN IF NOT EXISTS records_requested text[] NOT NULL DEFAULT '{}';
-- The investigator left off his review block, so nothing was listed to rule on.
ALTER TABLE interview_reviews ADD COLUMN IF NOT EXISTS review_block_missing boolean NOT NULL DEFAULT false;
ALTER TABLE interview_reviews DROP CONSTRAINT IF EXISTS interview_reviews_status_check;
ALTER TABLE interview_reviews ADD CONSTRAINT interview_reviews_status_check
  CHECK (status IN ('summarizing', 'failed', 'open', 'finalizing', 'completed'));

-- A team has one investigator request going at a time.
CREATE UNIQUE INDEX IF NOT EXISTS interview_reviews_one_investigation_idx ON interview_reviews (team_id)
  WHERE kind = 'investigation' AND status <> 'completed';

-- Case files the investigator says the team could get, and the instructor's
-- call on each: allow (the file is shared with the team) or deny.
CREATE TABLE IF NOT EXISTS review_documents (
  review_id   uuid NOT NULL REFERENCES interview_reviews (id) ON DELETE CASCADE,
  material_id uuid NOT NULL REFERENCES case_materials (id) ON DELETE CASCADE,
  position    integer NOT NULL DEFAULT 0,
  decision    text CHECK (decision IN ('allow', 'deny')),
  PRIMARY KEY (review_id, material_id)
);

-- Case files shared with particular case worlds or teams, on top of the
-- file's audience (everyone, a side, or instructors only).
CREATE TABLE IF NOT EXISTS material_shares (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id uuid NOT NULL REFERENCES case_materials (id) ON DELETE CASCADE,
  matchup_id  uuid REFERENCES matchups (id) ON DELETE CASCADE,
  team_id     uuid REFERENCES teams (id) ON DELETE CASCADE,
  CHECK ((matchup_id IS NULL) <> (team_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS material_shares_matchup_idx ON material_shares (material_id, matchup_id) WHERE matchup_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS material_shares_team_idx ON material_shares (material_id, team_id) WHERE team_id IS NOT NULL;

-- Information exchange -------------------------------------------------------

-- The subpoena phase became two: introduction (teams get the case and a
-- welcome email from their firm, and each student picks their initial
-- disclosures) and information_exchange (the instructor's initial disclosures
-- are shared, and teams send interrogatories and requests for admission).
-- The information exchange phase only exists once its setup is finished.
ALTER TABLE cases DROP CONSTRAINT IF EXISTS cases_phase_check;
UPDATE cases SET phase = 'introduction' WHERE phase = 'subpoena';
ALTER TABLE cases ALTER COLUMN phase SET DEFAULT 'introduction';
ALTER TABLE cases ADD CONSTRAINT cases_phase_check
  CHECK (phase IN ('introduction', 'information_exchange', 'investigate', 'deposition'));

-- A case's information exchange settings, from its own guided setup: which
-- parts are included, each team's limit and the days the other side has to
-- respond, and the firm and senior partner who sign each side's welcome
-- email. No row means it was never set up; students see none of it until
-- `setup_completed_at` is set.
CREATE TABLE IF NOT EXISTS information_exchange (
  case_id                 uuid        PRIMARY KEY REFERENCES cases (id) ON DELETE CASCADE,
  disclosures_enabled     boolean     NOT NULL DEFAULT true,
  subpoenas_enabled       boolean     NOT NULL DEFAULT true,
  subpoena_limit          integer     NOT NULL DEFAULT 3 CHECK (subpoena_limit BETWEEN 1 AND 100),
  subpoena_days           integer     NOT NULL DEFAULT 14 CHECK (subpoena_days BETWEEN 1 AND 365),
  interrogatories_enabled boolean     NOT NULL DEFAULT true,
  interrogatory_limit     integer     NOT NULL DEFAULT 25 CHECK (interrogatory_limit BETWEEN 1 AND 100),
  interrogatory_days      integer     NOT NULL DEFAULT 30 CHECK (interrogatory_days BETWEEN 1 AND 365),
  rfas_enabled            boolean     NOT NULL DEFAULT true,
  rfa_limit               integer     NOT NULL DEFAULT 25 CHECK (rfa_limit BETWEEN 1 AND 100),
  rfa_days                integer     NOT NULL DEFAULT 30 CHECK (rfa_days BETWEEN 1 AND 365),
  plaintiff_firm          text        NOT NULL DEFAULT '',
  plaintiff_partner       text        NOT NULL DEFAULT '',
  defense_firm            text        NOT NULL DEFAULT '',
  defense_partner         text        NOT NULL DEFAULT '',
  setup_completed_at      timestamptz,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- The instructor's initial disclosures: the witnesses and one-side case files
-- each side must disclose. They're the answer key for the students' picks,
-- and they're shared with both sides once the case leaves the introduction
-- phase: a disclosed file's audience becomes 'all' (its own audience is kept
-- in `original_audience` and comes back if the case returns to introduction).
CREATE TABLE IF NOT EXISTS disclosure_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id           uuid NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  material_id       uuid REFERENCES case_materials (id) ON DELETE CASCADE,
  witness_id        uuid REFERENCES case_witnesses (id) ON DELETE CASCADE,
  original_audience text CHECK (original_audience IN ('plaintiff', 'defense')),
  CHECK ((material_id IS NULL) <> (witness_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS disclosure_items_material_idx ON disclosure_items (material_id) WHERE material_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS disclosure_items_witness_idx ON disclosure_items (witness_id) WHERE witness_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS disclosure_items_case_idx ON disclosure_items (case_id);

-- Each student's own initial disclosure picks, submitted once. They're
-- practice: they never change what the other side sees.
CREATE TABLE IF NOT EXISTS disclosure_submissions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id            uuid        NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  user_id            uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  side               text        NOT NULL CHECK (side IN ('plaintiff', 'defense')),
  held_back_reason   text        NOT NULL DEFAULT '',
  submitted_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, user_id)
);

-- What the student disclosed, and why.
CREATE TABLE IF NOT EXISTS disclosure_picks (
  submission_id uuid NOT NULL REFERENCES disclosure_submissions (id) ON DELETE CASCADE,
  material_id   uuid REFERENCES case_materials (id) ON DELETE CASCADE,
  witness_id    uuid REFERENCES case_witnesses (id) ON DELETE CASCADE,
  reason        text NOT NULL,
  CHECK ((material_id IS NULL) <> (witness_id IS NULL))
);

CREATE INDEX IF NOT EXISTS disclosure_picks_submission_idx ON disclosure_picks (submission_id);

-- A set of interrogatories or requests for admission one team sends the
-- other team in its case world. The other team has until `due_at` to respond.
CREATE TABLE IF NOT EXISTS exchange_requests (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id      uuid        NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  kind         text        NOT NULL CHECK (kind IN ('interrogatories', 'rfas')),
  from_team_id uuid        NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  to_team_id   uuid        NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  sent_by      uuid        REFERENCES users (id) ON DELETE SET NULL,
  sent_at      timestamptz NOT NULL DEFAULT now(),
  due_at       timestamptz NOT NULL,
  responded_at timestamptz,
  responded_by uuid        REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS exchange_requests_case_idx ON exchange_requests (case_id);

-- One question or request in a set, one per line, and the response.
-- `weight` is how many it counts toward the team's limit: each subpart of an
-- interrogatory, like (a) and (b), counts as its own question.
-- Interrogatories get an `answer` (or an objection); requests for admission
-- get agree, disagree, or partial (with what's agreed and what isn't).
CREATE TABLE IF NOT EXISTS exchange_items (
  request_id   uuid    NOT NULL REFERENCES exchange_requests (id) ON DELETE CASCADE,
  position     integer NOT NULL,
  text         text    NOT NULL,
  weight       integer NOT NULL DEFAULT 1 CHECK (weight > 0),
  answer       text,
  objection    boolean NOT NULL DEFAULT false,
  admission    text    CHECK (admission IN ('agree', 'disagree', 'partial')),
  agree_part   text,
  disagree_part text,
  PRIMARY KEY (request_id, position)
);

-- Which students have read the responses to their team's requests.
CREATE TABLE IF NOT EXISTS exchange_seen (
  request_id uuid        NOT NULL REFERENCES exchange_requests (id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  seen_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, user_id)
);

-- A subpoena a team serves on a person or organization for records, from the
-- information exchange phase on, answered by `due_at` (see the drafting
-- columns below). The other team in the case world gets notice of it, but not
-- what was produced.
CREATE TABLE IF NOT EXISTS subpoenas (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id      uuid        NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  team_id      uuid        NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  -- The team's case world as it was when served, like a review's.
  matchup_id   uuid        REFERENCES matchups (id) ON DELETE SET NULL,
  world_number integer     NOT NULL,
  team_number  integer     NOT NULL,
  side         text        NOT NULL CHECK (side IN ('plaintiff', 'defense')),
  recipient    text        NOT NULL,
  records      text        NOT NULL,
  sent_by      uuid        REFERENCES users (id) ON DELETE SET NULL,
  sent_at      timestamptz NOT NULL DEFAULT now(),
  due_at       timestamptz NOT NULL,
  outcome      text        CHECK (outcome IN ('complied', 'quashed')),
  response     text,
  responded_at timestamptz,
  responded_by uuid        REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS subpoenas_case_idx ON subpoenas (case_id);

-- The case files produced in answer to a subpoena.
CREATE TABLE IF NOT EXISTS subpoena_documents (
  subpoena_id uuid    NOT NULL REFERENCES subpoenas (id) ON DELETE CASCADE,
  material_id uuid    NOT NULL REFERENCES case_materials (id) ON DELETE CASCADE,
  position    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (subpoena_id, material_id)
);

-- Which students have read the answer to their team's subpoena.
CREATE TABLE IF NOT EXISTS subpoena_seen (
  subpoena_id uuid        NOT NULL REFERENCES subpoenas (id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  seen_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subpoena_id, user_id)
);

-- Subpoenas ask for one kind of thing (the boxes on the federal form, AO 88B),
-- and the instructor chooses which kinds a case allows.
ALTER TABLE information_exchange ADD COLUMN IF NOT EXISTS subpoena_types text[] NOT NULL
  DEFAULT '{documents,esi,tangible_things,inspection}';
ALTER TABLE information_exchange DROP CONSTRAINT IF EXISTS information_exchange_subpoena_types_check;
ALTER TABLE information_exchange ADD CONSTRAINT information_exchange_subpoena_types_check
  CHECK (cardinality(subpoena_types) > 0
         AND subpoena_types <@ '{documents,esi,tangible_things,inspection}'::text[]);

-- The AI drafts each subpoena's response as the recipient, and the instructor
-- reviews the draft before the team sees anything:
-- drafting -> open (the draft is ready to review) -> answered, or failed.
-- The instructor approves (the response becomes a case file shared with the
-- team, with any existing files the draft produced) or denies it.
ALTER TABLE subpoenas ADD COLUMN IF NOT EXISTS request_type text NOT NULL DEFAULT 'documents'
  CHECK (request_type IN ('documents', 'esi', 'tangible_things', 'inspection'));
ALTER TABLE subpoenas ADD COLUMN IF NOT EXISTS recipient_description text NOT NULL DEFAULT '';
ALTER TABLE subpoenas ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open'
  CHECK (status IN ('drafting', 'open', 'failed', 'answered'));
-- The draft, with its tag lines taken off; `flag` is whether the AI thinks a
-- court would quash or modify the subpoena.
ALTER TABLE subpoenas ADD COLUMN IF NOT EXISTS draft text;
ALTER TABLE subpoenas ADD COLUMN IF NOT EXISTS flag text CHECK (flag IN ('quash', 'modify'));
-- Titles the draft named as existing files that matched no case file.
ALTER TABLE subpoenas ADD COLUMN IF NOT EXISTS unknown_titles text[] NOT NULL DEFAULT '{}';
-- The instructor's notes for the latest redraft, and whether it must create a
-- new file rather than produce existing ones.
ALTER TABLE subpoenas ADD COLUMN IF NOT EXISTS instructions text NOT NULL DEFAULT '';
ALTER TABLE subpoenas ADD COLUMN IF NOT EXISTS create_new boolean NOT NULL DEFAULT false;
ALTER TABLE subpoenas ADD COLUMN IF NOT EXISTS error text;
UPDATE subpoenas SET status = 'answered' WHERE responded_at IS NOT NULL AND status <> 'answered';
ALTER TABLE subpoenas DROP CONSTRAINT IF EXISTS subpoenas_outcome_check;
UPDATE subpoenas SET outcome = 'responded' WHERE outcome = 'complied';
UPDATE subpoenas SET outcome = 'denied' WHERE outcome = 'quashed';
ALTER TABLE subpoenas ADD CONSTRAINT subpoenas_outcome_check CHECK (outcome IN ('responded', 'denied'));

-- The existing case files a draft produces (by reference), in its order.
CREATE TABLE IF NOT EXISTS subpoena_existing (
  subpoena_id uuid    NOT NULL REFERENCES subpoenas (id) ON DELETE CASCADE,
  material_id uuid    NOT NULL REFERENCES case_materials (id) ON DELETE CASCADE,
  position    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (subpoena_id, material_id)
);

-- The case file an approved response became, and the other world's response
-- a draft adapted (the drafter reuses earlier responses to the same request).
ALTER TABLE subpoenas ADD COLUMN IF NOT EXISTS response_material_id uuid REFERENCES case_materials (id) ON DELETE SET NULL;
ALTER TABLE subpoenas ADD COLUMN IF NOT EXISTS based_on_material_id uuid REFERENCES case_materials (id) ON DELETE SET NULL;

-- A case file that belongs to one case world, like a subpoena response: only
-- that world's witnesses, investigators and subpoena recipients read it.
ALTER TABLE case_materials ADD COLUMN IF NOT EXISTS matchup_id uuid REFERENCES matchups (id) ON DELETE CASCADE;

-- Copying a case (duplicating it, or accepting one another instructor
-- shared): the copy starts as a draft whose guided setup is only its teams and
-- worlds (copy_setup), and remembers where it came from.
ALTER TABLE cases ADD COLUMN IF NOT EXISTS copy_setup boolean NOT NULL DEFAULT false;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS copied_from_title text;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS copied_from_name text;

-- A case one instructor shared with another, waiting for them to accept (the
-- case is copied into one of their classes then) or decline. Either way the row
-- goes; deleting the case takes its pending shares with it.
CREATE TABLE IF NOT EXISTS case_shares (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id       uuid        NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  from_user_id  uuid        REFERENCES users (id) ON DELETE SET NULL,
  to_user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  include_tasks boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, to_user_id)
);

CREATE INDEX IF NOT EXISTS case_shares_to_idx ON case_shares (to_user_id);

-- Where a case file came from: uploaded by the instructor, or a subpoena
-- response approved in one case world. The AI reads every instructor file,
-- and only the requesting team's own world's subpoena responses.
ALTER TABLE case_materials ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'instructor'
  CHECK (source IN ('instructor', 'subpoena'));
UPDATE case_materials SET source = 'subpoena'
  WHERE source <> 'subpoena' AND id IN (SELECT response_material_id FROM subpoenas WHERE response_material_id IS NOT NULL);

-- Login sessions, in the format connect-pg-simple expects.
CREATE TABLE IF NOT EXISTS session (
  sid    varchar      PRIMARY KEY,
  sess   json         NOT NULL,
  expire timestamp(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS session_expire_idx ON session (expire);

-- The course calendar's own events (tasks show up on their due dates too).
-- case: a date the instructor marks for a case, for everyone in it.
-- personal: one user's own reminder. team: shared with one team's members.
CREATE TABLE IF NOT EXISTS calendar_events (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id  uuid        NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  kind       text        NOT NULL CHECK (kind IN ('case', 'personal', 'team')),
  case_id    uuid        REFERENCES cases (id) ON DELETE CASCADE,
  team_id    uuid        REFERENCES teams (id) ON DELETE CASCADE,
  title      text        NOT NULL,
  notes      text        NOT NULL DEFAULT '',
  on_date    date        NOT NULL,
  created_by uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'case' OR (case_id IS NOT NULL AND team_id IS NULL)),
  CHECK (kind <> 'team' OR team_id IS NOT NULL),
  CHECK (kind <> 'personal' OR (case_id IS NULL AND team_id IS NULL))
);

CREATE INDEX IF NOT EXISTS calendar_events_course_idx ON calendar_events (course_id, on_date);

-- The AI's suggested witnesses, read from the initial file once the parties are
-- named. `key` is what they were made from (initial file and party names), so
-- they're made again if that changes. Offered once: when the instructor adds
-- some or skips them, `done_at` is set and they're never shown again.
ALTER TABLE cases ADD COLUMN IF NOT EXISTS witness_suggestions jsonb;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS witness_suggestions_key text;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS witness_suggestions_status text;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS witness_suggestions_done_at timestamptz;

-- Word documents (.docx) weren't read before; read the ones marked as having no text again.
UPDATE case_materials SET text_status = 'pending', text_error = NULL
 WHERE text_status = 'none'
   AND content_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

-- A subpoena's justification: what the requesting team would tell the judge
-- about its validity, relevance, and proportionality on a motion to quash or
-- modify. The recipient weighs it, and the instructor sees it.
ALTER TABLE subpoenas ADD COLUMN IF NOT EXISTS justification text NOT NULL DEFAULT '';

-- The discovery mentor's checks on a team's draft (a subpoena, a set of
-- interrogatories or requests for admission, or answers to a set), before
-- the team sends it. `content_hash` is what was checked, so a submission can
-- tell whether it's the draft the mentor saw or was edited since.
CREATE TABLE IF NOT EXISTS discovery_checks (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id      uuid        NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  team_id      uuid        NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  kind         text        NOT NULL CHECK (kind IN ('subpoena', 'interrogatories', 'rfas')),
  mode         text        NOT NULL CHECK (mode IN ('draft', 'answer')),
  request_id   uuid        REFERENCES exchange_requests (id) ON DELETE CASCADE,
  content_hash text        NOT NULL,
  tag          text        NOT NULL CHECK (tag IN ('LOOKS_GOOD', 'SMALL_EDITS', 'NEEDS_IMPROVEMENT')),
  feedback     text        NOT NULL,
  checked_by   uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS discovery_checks_team_idx ON discovery_checks (team_id);

-- The last check before a submission, for the instructor: its tag and
-- feedback, and whether the submission is the draft that was checked (false:
-- edited after). Null tag: sent without a check. On a set, check_* is the
-- sending team's and response_check_* the answering team's.
ALTER TABLE subpoenas ADD COLUMN IF NOT EXISTS check_tag text;
ALTER TABLE subpoenas ADD COLUMN IF NOT EXISTS check_feedback text;
ALTER TABLE subpoenas ADD COLUMN IF NOT EXISTS check_current boolean NOT NULL DEFAULT false;
ALTER TABLE exchange_requests ADD COLUMN IF NOT EXISTS check_tag text;
ALTER TABLE exchange_requests ADD COLUMN IF NOT EXISTS check_feedback text;
ALTER TABLE exchange_requests ADD COLUMN IF NOT EXISTS check_current boolean NOT NULL DEFAULT false;
ALTER TABLE exchange_requests ADD COLUMN IF NOT EXISTS response_check_tag text;
ALTER TABLE exchange_requests ADD COLUMN IF NOT EXISTS response_check_feedback text;
ALTER TABLE exchange_requests ADD COLUMN IF NOT EXISTS response_check_current boolean NOT NULL DEFAULT false;
