# Trial Advocacy

A pre-trial litigation simulator for law students. CS 397 (Innovation Lab) quarter project.

Built with React + TypeScript (Vite) on the frontend and an Express API backed by PostgreSQL in `server/`.

## Getting started

Requires Node.js 24+ and PostgreSQL.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a local database:

   ```bash
   createdb -U postgres trial_advocacy_dev
   ```

3. Copy `.env.example` to `.env.local` and set `DATABASE_URL` to point at that database.

4. Create the tables:

   ```bash
   npm run db:migrate
   ```

   Optionally add demo data: a demo instructor, three courses, and a class of 31 demo students enrolled in LAW 540 (enough to practice pairing). Every demo account's password is `demo-password`; the script prints the logins and entry codes, and is safe to re-run:

   ```bash
   npm run db:seed
   ```

5. Start the API and the web app together:

   ```bash
   npm run dev
   ```

Then open the URL Vite prints (usually http://localhost:5173). Vite forwards `/api` requests to the API on port 3001.

To preview a student's course home page with made-up cases, activity, and deadlines, add `?sample` to the course URL (e.g. `/courses/<id>?sample`). This only works in development; production builds leave the sample data out.

## Scripts

| Command              | What it does                                         |
| -------------------- | ---------------------------------------------------- |
| `npm run dev`        | Start the API and web app with hot reload            |
| `npm run dev:client` | Start only the Vite dev server                       |
| `npm run dev:server` | Start only the API (restarts on file changes)        |
| `npm run db:migrate` | Apply `server/db/schema.sql` to the database         |
| `npm run db:seed`    | Add demo accounts and courses (dev only)             |
| `npm run storage:migrate` | Move case files still stored in Postgres into storage (runs on each Heroku release) |
| `npm run storage:check` | Check the case file storage (S3 or `.storage/`) end to end |
| `npm run build`      | Type-check everything and build the web app (`dist/`) |
| `npm start`          | Run the API in production (also serves `dist/`)      |
| `npm test`           | Run all tests once                                   |
| `npm run test:watch` | Re-run tests as files change                         |
| `npm run lint`       | Run ESLint                                           |

## Testing

Tests use [Vitest](https://vitest.dev) and live next to the code they test (`*.test.ts(x)`):

- **`server/**/*.test.ts`**: API tests that send real HTTP requests to the Express app and use a real Postgres database.
- **`src/**/*.test.tsx`**: UI tests that render the React pages in a simulated browser against fake services (see `src/test/fakeCourseService.ts`).

Shared test setup lives in `server/test/` and `src/test/`; the tests themselves stay beside their code.

The API tests wipe their tables between tests, so they use a separate database, `trial_advocacy_test`, never your dev one. Create it once:

```bash
createdb -U postgres trial_advocacy_test
```

By default the tests reuse the username and password from `DATABASE_URL` in `.env.local`. To point them somewhere else, set `TEST_DATABASE_URL`. The database name must end in `_test`, or the tests refuse to run.

GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs lint, build and all tests on every pull request and on pushes to `main`, using a throwaway Postgres container.

## Themes and dark mode

Every colour comes from a token in [`src/theme/tokens.css`](src/theme/tokens.css), so stylesheets use `var(--token)` instead of raw colours. Two attributes on `<html>` pick the tokens:

- `data-palette`: the account's theme, one of `navy` (the default), `forest`, `lagoon`, `vivid` or `stone`. It's saved on the account (`PATCH /api/auth/me`) and kept in `localStorage`, so it applies before the user loads.
- `data-theme`: `light` or `dark`. Each visit starts from the system setting; the toggle in the sidebar (and on the sign-in page) lasts for that visit only (`sessionStorage`).

A small script in `index.html` sets both before the page paints, so there's no flash of the wrong colours. Each palette has a light and a dark block in `tokens.css`; a new colour needs a token in all ten.

## API

| Method | Path               | Body                                | Result                    |
| ------ | ------------------ | ----------------------------------- | ------------------------- |
| GET    | `/api/auth/me`     |                                     | `{ user }` or `{ user: null }`; `user` has `theme` and `avatarUrl` (null until they add a profile picture) |
| POST   | `/api/auth/signup` | `{ name, email, password, role }`   | `201 { user }`, `409` if email taken |
| POST   | `/api/auth/login`  | `{ email, password }`               | `{ user }`, `401` if wrong |
| POST   | `/api/auth/logout` |                                     | `204`                     |
| PATCH  | `/api/auth/me`     | `{ name?, theme? }`                 | `{ user }`; `theme` is `navy`, `forest`, `lagoon`, `vivid` or `stone`. `401` signed out, `400` blank or too-long name (100 characters) or an unknown theme |
| PUT    | `/api/auth/me/avatar` | The picture itself, `Content-Type: image/png` or `image/jpeg` (at most 1 MB) | `{ user }` with the new `avatarUrl`; the old picture is deleted. The browser crops it to 512×512 first. `400` not a PNG or JPEG (checked from the file, not the header), `413` too large |
| DELETE | `/api/auth/me/avatar` |                                  | `{ user }` with `avatarUrl: null` (back to initials) |
| GET    | `/api/users/:id/avatar` |                                | Signed-in users: the picture. `avatarUrl` (`/api/users/:id/avatar?v=…`) changes with every new picture, so that URL is cached for good. `404` without one |
| GET    | `/api/courses`     |                                     | `{ courses }` the user is enrolled in, newest term first |
| POST   | `/api/courses/join`| `{ entryCode }`                     | `201 { course }`; `404` unknown code, `409` already enrolled, `403` instructors |
| GET    | `/api/courses/:id/home` |                                | Enrolled students (and the instructor): `{ course, cases, activity, upcoming, stats }` for the course home page. Students get the active and closed cases they're on a team in, each with `world: { number, side }` (or `null` before matching), `progress` (percent of their team's tasks done), and `nextTask`; `upcoming` lists their open tasks' deadlines and `stats` counts completed tasks. The instructor gets every active and closed case with `worldCount`. `activity` is always empty for now |
| GET    | `/api/courses/:id/my-cases` |                             | Members: `{ cases: [{ id, title, summary, status, team, world }] }`, without drafts; `team` is `{ number, members }` (each member has `you`) or `null` before pairing; `world` is `{ number, side, opponents: { number, members } }` or `null` before matching |
| GET    | `/api/courses/:id/my-cases/:caseId` |                     | Students: `{ workspace }`, the case dashboard: `{ case, team, world, side, materials, witnesses, investigatorAvailable, tasks, preview }`, showing only shared items and their side's (`case` includes the `phase`). Witnesses follow the phase (see below) and carry only `{ id, name, role, description, audience, side, canInterview }`, never their AI setup. Each task has the team's `completedAt` / `completedBy`. `404` for drafts |
| GET    | `/api/courses/:id/my-cases/:caseId/materials/:materialId/file` | | `302` to a 5-minute download link, if the student's side can see it |
| GET / POST | `/api/courses/:id/my-cases/:caseId/witnesses/:witnessId/interview` (`/questions`, `/restart`) | `{ question }` | The team's interview of a witness its side can see, shared by both partners and always asked as the team's own side (any `side` in the request is ignored); same shapes as the instructor's. `409` before the team is matched, or once the case is closed (read-only) |
| POST   | `/api/courses/:id/my-cases/:caseId/witnesses/:witnessId/interview/end` | | Ends the team's interview and sends it to the instructor for review (unless it's empty): `{ interview, sentForReview }`, with `interview` a fresh, empty one |
| GET    | `/api/courses/:id/my-cases/:caseId/reviews` | | `{ reviews: [{ id, witness, completedAt, accepted, denied, seen }] }`: the team's completed reviews, each fact only as accepted or denied |
| POST   | `/api/courses/:id/my-cases/:caseId/reviews/seen` | | `204`; marks the team's review results read for this student |
| PUT    | `/api/courses/:id/my-cases/:caseId/tasks/:taskId` | `{ done: boolean }`   | `{ workspace }`; marks it done (or not) for the student's whole team. `409` if the case is closed or the student has no team |
| GET    | `/api/courses/teaching` |                                | Instructors: `{ courses }` they teach, with `entryCode` and `studentCount` |
| POST   | `/api/courses`     | `{ code, title, season, year }`     | Instructors: `201 { course }` with a new entry code |

These manage one course and are only for the instructor who teaches it (anyone else gets `404`):

| Method | Path                                         | Body / headers                   | Result |
| ------ | -------------------------------------------- | -------------------------------- | ------ |
| GET    | `/api/courses/:id`                           |                                  | `{ course }` |
| PATCH  | `/api/courses/:id`                           | `{ code, title, season, year }`  | `{ course }`; entry code and roster unchanged |
| DELETE | `/api/courses/:id`                           |                                  | `204`; also deletes the roster and the cases with everything in them |
| GET    | `/api/courses/:id/roster`                    |                                  | `{ roster: [{ email, name, joined, avatarUrl }] }` |
| POST   | `/api/courses/:id/roster`                    | `{ emails: string[] }`           | `{ added, skipped: [{ email, reason }], roster }` |
| DELETE | `/api/courses/:id/roster/:email`             |                                  | `204`, `404` if not on the roster |
| GET    | `/api/courses/:id/cases`                     |                                  | `{ cases: [{ id, title, summary, status, phase, importantFacts, createdAt, updatedAt }] }`, oldest first. `importantFacts` is `{ plaintiff: string[], defense: string[] }`: the most important facts for each side, which the AI witnesses never contradict and students never see |
| POST   | `/api/courses/:id/cases`                     | `{ title, summary?, status?, importantFacts }` | `201 { case }`; status defaults to `draft`. `importantFacts` needs at least one fact per side (at most 20, each up to 500 characters) |
| GET    | `/api/courses/:id/cases/:caseId`             |                                  | `{ case }` |
| PATCH  | `/api/courses/:id/cases/:caseId`             | `{ title, summary, status, importantFacts }` | `{ case }`; status and `importantFacts` are required here |
| DELETE | `/api/courses/:id/cases/:caseId`             |                                  | `204` |
| GET    | `/api/courses/:id/cases/:caseId/teams`       |                                  | `{ teams: [{ id, number, members }], unpaired, matchups: [{ id, number, plaintiffTeamId, defenseTeamId }] }` (members and unpaired are roster entries). Every team and matchup change responds with this shape |
| POST   | `/api/courses/:id/cases/:caseId/teams`       | `{ emails: string[] }` (1–3)     | `201`, the teams; `400` not on the roster, `409` already on a team |
| POST   | `/api/courses/:id/cases/:caseId/teams/auto`  |                                  | The teams, after pairing every unpaired student at random; `409` if nobody is left |
| DELETE | `/api/courses/:id/cases/:caseId/teams`       |                                  | The teams (now none): unpairs everyone |
| DELETE | `/api/courses/:id/cases/:caseId/teams/:teamId` |                                | The teams, without that one |
| POST   | `/api/courses/:id/cases/:caseId/teams/:teamId/members` | `{ email }`              | The teams; `409` if the team already has 3 |
| DELETE | `/api/courses/:id/cases/:caseId/teams/:teamId/members/:email` |                   | The teams; a team left empty is deleted |
| POST   | `/api/courses/:id/cases/:caseId/matchups`    | `{ plaintiffTeamId, defenseTeamId }` | `201`, the teams (with the new matchup); `409` if a team is already in a world |
| POST   | `/api/courses/:id/cases/:caseId/matchups/auto` |                                | The teams, after matching every waiting team; `409` if fewer than two are waiting |
| DELETE | `/api/courses/:id/cases/:caseId/matchups`    |                                  | The teams, with no matchups left |
| POST   | `/api/courses/:id/cases/:caseId/matchups/:matchupId/swap` |                     | The teams, with that world's sides swapped |
| DELETE | `/api/courses/:id/cases/:caseId/matchups/:matchupId` |                          | The teams, without that world |
| GET    | `/api/courses/:id/cases/:caseId/materials` |                                 | `{ materials: [{ id, audience, filename, description, contentType, sizeBytes, uploadedAt, textStatus, textError }] }`, in upload order. `textStatus` is the AI transcription: `pending`, `ready`, `failed` (with `textError`), or `none` |
| POST   | `/api/courses/:id/cases/:caseId/materials/uploads` | `{ filename, size }` | Step 1 of an upload: `201 { upload: { key, url, headers } }`, a 15-minute link to `PUT` the file to (S3 in production) with exactly those headers. `413` over 100 MB, `415` unless a document (PDF, Word, text), image (PNG, JPEG, GIF, WebP), audio (MP3, M4A, WAV), or video (MP4, MOV, WebM) |
| POST   | `/api/courses/:id/cases/:caseId/materials` | `{ uploadKey, filename, audience?, description? }` | Step 2, after the `PUT`: `201 { material }`; `audience` is `all` (default), `plaintiff`, `defense`, or `instructor` (never shown to students). Starts the file's transcription. `400` if the upload didn't finish or belongs to another case |
| PATCH  | `/api/courses/:id/cases/:caseId/materials/:materialId` | `{ audience, description }` | `{ material }` |
| GET    | `/api/courses/:id/cases/:caseId/materials/:materialId/file` |                  | `302` to a 5-minute download link |
| GET / POST | `/api/courses/:id/cases/:caseId/materials/:materialId/text` | | The transcription as `text/plain` (`404` until ready) / transcribe again: `{ material }` when done |
| DELETE | `/api/courses/:id/cases/:caseId/materials/:materialId` |                       | `204`; also deletes the stored file |
| GET / POST | `/api/courses/:id/cases/:caseId/witnesses` | `{ name, role?, description?, audience?, alignedSide?, depositionMaterialId?, knownMaterialIds?, personaNotes?, defendingCounsel?, avatarPreset? }` | `{ witnesses }` / `201 { witness }`. With `alignedSide` (`plaintiff` / `defense`) and a deposition file from this case, an AI witness. `avatarPreset` (1–12) picks one of the designs in `public/witness-avatars/` and replaces an uploaded picture; every witness payload (students' and interviews' too) has `avatarUrl`: the design, the uploaded picture, or null |
| PUT / DELETE | `/api/courses/:id/cases/:caseId/witnesses/:witnessId` | Same as POST            | `{ witness }` / `204` |
| PUT / DELETE | `/api/courses/:id/cases/:caseId/witnesses/:witnessId/avatar` | PUT: the picture itself, PNG or JPEG (at most 1 MB) | `{ witness }`; an uploaded picture (cropped in the browser) in place of the design, or (DELETE) none |
| GET    | `/api/witnesses/:witnessId/avatar` |                    | The course's instructor and students: the uploaded picture, cached for good at its versioned `avatarUrl`; `404` for anyone else |
| GET | `/api/courses/:id/cases/:caseId/witnesses/:witnessId/interview?side=` | | The instructor's test interview as `plaintiff` or `defense`, kept apart from every team's: `{ interview: { id, side, witness, turns, maxTurns, canAsk, notice } }` |
| POST | `…/witnesses/:witnessId/interview/questions?side=` | `{ question }` | Asks the witness; `{ interview }` with the answer. `409` if the witness isn't set up, `503` without an API key |
| POST | `…/witnesses/:witnessId/interview/restart?side=` | | Ends it and starts an empty one: `{ interview }` |
| PUT | `/api/courses/:id/cases/:caseId/witness-settings` | `{ inWorldDate: 'YYYY-MM-DD' \| null, disputedIssues }` | `{ case }`. Shared by the case's AI witnesses |
| GET / POST | `/api/courses/:id/cases/:caseId/tasks` | `{ title, description?, dueAt?, audience? }` | `{ tasks }` (soonest due first) / `201 { task }`; `dueAt` is an ISO timestamp or `null` |
| PUT / DELETE | `/api/courses/:id/cases/:caseId/tasks/:taskId` | Same as POST                   | `{ task }` / `204`; deleting removes teams' completions |
| PUT    | `/api/courses/:id/cases/:caseId/note` | `{ note }`                                    | `{ case }`; the instructor note shown on every student's case dashboard |
| PUT    | `/api/courses/:id/cases/:caseId/phase` | `{ phase }`                                  | `{ case }`; moves every case world to `subpoena`, `investigate`, or `deposition` (forward or back). `409` once the case is closed |
| GET    | `/api/courses/:id/reviews?status=open\|completed` | | `{ reviews }` to do (including `summarizing` and `failed`) or completed: `{ id, caseTitle, witness, worldNumber, teamNumber, side, team, status, error, createdAt, completedAt, facts: [{ id, text, decision }] }` |
| PUT    | `/api/courses/:id/reviews/:reviewId/facts/:factId` | `{ decision }` | `{ review }`; `accept_world`, `deny_world`, `accept_case`, or `deny_case`. `409` once completed |
| POST   | `/api/courses/:id/reviews/:reviewId/complete` \| `/retry` | | `{ review }`; complete needs a ruling on every fact (`409`); retry is for a `failed` summary |
| GET    | `/api/courses/:id/reviews/:reviewId/transcript` | | `{ turns: [{ question, objection, answer, askedBy }] }` |
| GET    | `/api/courses/:id/cases/:caseId/launch` |                                             | `{ checks: [{ key, ok, message }] }`: everyone paired, every team matched, at least one case file uploaded |
| POST   | `/api/courses/:id/cases/:caseId/launch` |                                             | `{ case }`, now `active`; `409` if not ready (the message lists what's missing) or already launched |
| GET    | `/api/courses/:id/cases/:caseId/preview?side=&matchup=` |                             | `{ workspace }`: the case dashboard as a team on `side` sees it (that world's team, with `matchup`), with `preview: true` |

All `/api/courses` routes return `401` when not logged in.

**Cases** are shared by the whole class. A case's `status` is `draft` (hidden from students), `active`, or `closed`. Students are paired into **teams** per case: usually two, with one team of three for an odd class. Team members are roster entries, so pending students can be paired too, and removing a student from the roster takes them off their teams. Auto-pairing avoids repeating partners from the course's other cases where it can. Each **matchup** sets two teams against each other as plaintiff and defense, and is one **case world** (matchup `number` 1 is World A). The side is stored on the matchup, not the team. Auto-matching avoids opponents students faced in the course's other cases and gives each team the side its members have argued less. Deleting a team deletes its matchup. A closed case's teams and matchups can't change (`409`).

Every case also has a **phase**, shared by all of its case worlds and set by the instructor. New cases start in `subpoena`. In `subpoena` and `investigate`, a witness who testifies for one side (`alignedSide`) is hidden from the other side's teams, so they can neither see nor interview them; other witnesses follow their `audience`. From `investigate` on, the background investigator is open (`investigatorAvailable` on the student's case dashboard; for now a placeholder). In `deposition`, every witness is revealed to both sides, and a team can depose the other side's AI witnesses, always as its own side.

Each case also has a **case file** (the pieces of the fact pattern: documents, images, audio, and video, told apart only by file type), **witnesses**, **tasks**, and an instructor note. Every material, witness, and task has an `audience`: everyone in the case, or only the plaintiff or defense teams; students see shared items plus their side's (only shared items before their team is matched). Teams mark tasks done, and their progress is the share of tasks done. **Launching** a draft case (`POST …/launch`) makes it active once everyone is paired, every team is matched, and the case file has at least one file.

**Rosters are keyed by email.** An instructor can add a student who has no account yet; that roster row is "pending" until someone signs up with the email (or joins with the entry code), and then it links to their account automatically.

Errors come back as `{ error: "message" }`. Logins are kept in an httpOnly session cookie stored in the `session` table.

## AI witnesses

Teams interview AI witnesses, played by Claude (the model set by `CLAUDE_MODEL`, `claude-haiku-5-5` by default; see below). A witness isn't fine-tuned: each answer is generated from a system prompt rendered from two Mustache templates in `server/witness/templates/`, the **witness initialization** (who the witness is, the case, the case documents labelled by how binding they are and whether the witness knows them, and the rules for filling gaps truthfully) followed by the **deposition session** (which side is asking, how to answer, and the defending lawyer's objections). The code is in `server/witness/` and `server/ai/`.

The instructor sets a witness up in the app:

1. **Upload the deposition** to the case file as *Instructors only*. Students never see or download instructor-only files.
2. **Every case file is transcribed** by Claude once, in the background, after it's uploaded (`server/ai/transcribe.ts`): tables as `|`-separated rows, photos and screenshots described in brackets. The Case file tab shows each file's status, with *View text* to check what the witnesses read and *Retry* if it failed. Audio and video have nothing to read yet.
3. **Create the witness** in the Witnesses tab: the side they testify for, their deposition file, the other files they have seen, their background and demeanor, and their lawyer (who may object when the other side asks). A witness with a side and a deposition is an AI witness.
4. **Set the case-wide settings** in the same tab: today's date inside the case and the issues every witness must leave disputed.

The witness reads its deposition as its own account, the files it has seen as records it knows, the other student files as records it doesn't know, and other instructor-only files (other witnesses' depositions) as someone else's account. Before the deposition, teams **interview** each witness: the *Interview* button in the student Witnesses tab. Each team shares one interview per witness, always as its own side (the witness treats them as that side's lawyers; they can't switch), saved turn by turn; *Start over* begins a new one. Every team starts with an empty interview. A team's interview lasts at most **one hour from its first question**: students are told when they start, see a countdown in the corner, and get a warning with 5 minutes left; then it ends on its own and goes to the instructor for review, like *End interview* (the server also ends interviews nobody comes back to, every minute). The instructor tests a witness with *Test as plaintiff* / *Test as defense* in the Witnesses tab; those runs are kept apart from the teams, and the Student view preview shows the Interview button without opening anything. Depositions themselves, with instructor deadlines, come later.

**Costs.** Each AI step uses the model in `CLAUDE_MODEL` (default `claude-haiku-5-5`, the cheapest); set `CLAUDE_WITNESS_MODEL`, `CLAUDE_TRANSCRIBE_MODEL`, `CLAUDE_REVIEW_MODEL`, or `CLAUDE_EVAL_MODEL` to change one step, and restart the server. To keep costs down:
- The witness's case file and instructions are cached for an hour (an interview's whole length), so only the first question pays full price for them; the growing transcript is cached for 5 minutes.
- Witnesses think at low effort; file reading doesn't think at all (copying text doesn't need it).
- Each file is read once. *Retry* only works on a file whose reading failed; a file that already has text isn't read again (upload a new version instead).
- The review step caches the case file too, so reviews close together share it.

Check actual spend in the Claude Console.

Set `ANTHROPIC_API_KEY` (and optionally `CLAUDE_MODEL`) in `.env.local`, and as Heroku config vars. For the terminal tools, eval cases, saved transcripts, and eval results live in the git-ignored `.material/witnesses/<name>/`, since they quote the confidential fact pattern:

| Command | What it does |
| --- | --- |
| `npm run witness:chat -- --witness "Name" --side plaintiff` | Question an app witness in the terminal, without saving to the app (`--side defense`, `--attorney "Mr. X"`) |
| `npm run witness:eval -- --witness "Name"` | Run the witness's behavioral eval against the real model (prints the tokens used; `--case <id>`, `--repeat N`, `--effort medium`) |

`npm test` covers transcription bookkeeping, witness setup, interviews, prompt rendering, request building, reply parsing, and eval checks with Claude faked; it never calls the API.

## Review panel

The instructor is the judge of the facts AI witnesses add. When a team presses **End interview** (as opposed to *Start over*, which discards), the conversation goes to the instructor's **Review** page (it replaces Resource library for instructors; the course dashboard and the nav show how many are waiting). In the background, Claude compares the transcript with the case files and the facts already settled for that world and case, and lists only the **new facts** the witness added (`server/witness/newFacts.ts`; a review with none is completed automatically).

For each new fact the instructor chooses **accept for this world**, **deny for this world**, **accept for all worlds**, or **deny for all worlds**, then **Finish review**. From then on, every witness prompt for that world (or every world, for the case-wide rulings) lists the accepted facts as settled and the denied ones as things that aren't true (`server/reviews/reviews.ts`, `settledFacts`). The team gets a notice and a **Reviews** tab in the case showing each fact only as *Accepted* or *Denied*. Rulings are stored in `interview_reviews` and `review_facts`; there is no vector store, since the whole case file already goes into each prompt.

## Deploying to Heroku

The `Procfile` runs migrations on each release and starts the API, which also serves the built frontend. One-time setup:

```bash
heroku addons:create heroku-postgresql:essential-0
heroku config:set SESSION_SECRET=<long random string>
heroku config:set ANTHROPIC_API_KEY=<your Claude API key>
heroku config:set CLAUDE_MODEL=claude-haiku-5-5   # optional; this is the default
```

Without `ANTHROPIC_API_KEY`, uploads still work but files aren't transcribed and the AI witnesses say they aren't set up. Set a monthly spend limit in the Claude Console; costs depend on the model in `CLAUDE_MODEL`.

Case files are stored in Amazon S3, and the app won't start in production without it. Follow [docs/s3-setup.md](docs/s3-setup.md) to create the bucket and access key, then set `S3_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY`. After the first deploy, add the app's `https://<app>.herokuapp.com` address to the bucket's CORS `AllowedOrigins` (step 3 there), or uploads fail. Locally, without those settings, files go to a git-ignored `.storage/` folder.
