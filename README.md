# Getting to Trial

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

- `data-palette`: the account's theme, one of `navy` (the default), `slate`, `earth`, `vibrant`, `forest`, `lagoon` or `contrast`. It's saved on the account (`PATCH /api/auth/me`) and kept in `localStorage`, so it applies before the user loads.
- `data-theme`: `light` or `dark`. Each visit starts from the system setting; the toggle in the sidebar (and on the sign-in page) lasts for that visit only (`sessionStorage`).

A small script in `index.html` sets both before the page paints, so there's no flash of the wrong colours. Each palette has a light and a dark block in `tokens.css`. In dark mode the page goes dark but cards stay light-toned: each dark block also sets `--card-*` colours (its light theme, dimmed), and one rule at the end of the file gives them to every card class it lists, so a new kind of card needs adding there. A new colour needs a token in every palette, light, dark and card.

## API

| Method | Path               | Body                                | Result                    |
| ------ | ------------------ | ----------------------------------- | ------------------------- |
| GET    | `/api/auth/me`     |                                     | `{ user }` or `{ user: null }`; `user` has `theme` and `avatarUrl` (null until they add a profile picture) |
| POST   | `/api/auth/signup` | `{ name, email, password, role }`   | `201 { user }`, `409` if email taken |
| POST   | `/api/auth/login`  | `{ email, password }`               | `{ user }`, `401` if wrong |
| POST   | `/api/auth/logout` |                                     | `204`                     |
| PATCH  | `/api/auth/me`     | `{ name?, theme? }`                 | `{ user }`; `theme` is `navy`, `slate`, `earth`, `vibrant`, `forest`, `lagoon` or `contrast`. `401` signed out, `400` blank or too-long name (100 characters) or an unknown theme |
| PUT    | `/api/auth/me/avatar` | The picture itself, `Content-Type: image/png` or `image/jpeg` (at most 1 MB) | `{ user }` with the new `avatarUrl`; the old picture is deleted. The browser crops it to 512×512 first. `400` not a PNG or JPEG (checked from the file, not the header), `413` too large |
| DELETE | `/api/auth/me/avatar` |                                  | `{ user }` with `avatarUrl: null` (back to initials) |
| GET    | `/api/users/:id/avatar` |                                | Signed-in users: the picture. `avatarUrl` (`/api/users/:id/avatar?v=…`) changes with every new picture, so that URL is cached for good. `404` without one |
| GET    | `/api/courses`     |                                     | `{ courses }` the user is enrolled in, newest term first |
| POST   | `/api/courses/join`| `{ entryCode }`                     | `201 { course }`; `404` unknown code, `409` already enrolled, `403` instructors |
| GET    | `/api/courses/:id/home` |                                | Enrolled students (and the instructor): `{ course, cases, activity, upcoming, stats }` for the course home page. Students get the active and closed cases they're on a team in, each with `world: { number, side }` (or `null` before matching), `progress` (percent of their team's tasks done), and `nextTask`; `upcoming` lists their open tasks' deadlines and `stats` counts completed tasks. The instructor gets every active and closed case with `worldCount`. `activity` is always empty for now |
| GET    | `/api/courses/:id/my-cases` |                             | Members: `{ cases: [{ id, title, summary, status, team, world }] }`, without drafts; `team` is `{ number, members }` (each member has `you`) or `null` before pairing; `world` is `{ number, side, opponents: { number, members } }` or `null` before matching |
| GET    | `/api/courses/:id/my-cases/:caseId` |                     | Students: `{ workspace }`, the case dashboard: `{ case, team, world, side, materials, witnesses, investigator, investigatorAvailable, tasks, preview }`, showing only shared items, their side's, and files shared with their team or world (`case` includes the `phase` and `reviewMode`). Witnesses follow the phase (see below) and carry only `{ id, name, role, description, audience, side, canInterview }`, never their AI setup. Each task has the team's `completedAt` / `completedBy`. `404` for drafts |
| GET    | `/api/courses/:id/my-cases/:caseId/materials/:materialId/file` | | `302` to a 5-minute download link, if the student's side can see it |
| GET / POST | `/api/courses/:id/my-cases/:caseId/witnesses/:witnessId/interview` (`/questions`, `/restart`) | `{ question }` | The team's interview of a witness its side can see, shared by both partners and always asked as the team's own side (any `side` in the request is ignored); same shapes as the instructor's. `409` before the team is matched, or once the case is closed (read-only) |
| POST   | `/api/courses/:id/my-cases/:caseId/witnesses/:witnessId/interview/end` | | Ends the team's interview and sends it to the instructor for review (unless it's empty): `{ interview, sentForReview }`, with `interview` a fresh, empty one |
| GET    | `/api/courses/:id/my-cases/:caseId/reviews` | | `{ reviews: [{ id, witness, completedAt, accepted, denied, items, seen }] }`: the team's completed reviews, each fact only as accepted or denied (`items` adds each fact's `id` and `auto`, for flagging) |
| POST   | `/api/courses/:id/my-cases/:caseId/reviews/seen` | | `204`; marks the team's review results read for this student |
| GET    | `/api/courses/:id/my-cases/:caseId/flags` | | `{ flags: [{ id, kind, targetId, reviewId, reason, status, resolution, createdAt, resolvedAt, seen }] }`, the team's flags on things decided automatically (review lite) |
| POST   | `/api/courses/:id/my-cases/:caseId/flags` | `{ kind, targetId, reviewId, reason }` | `201 { flags }`; `kind` is `fact`, `document` (with the report's `reviewId`), or `subpoena`. `409` unless it was decided automatically and still stands, or when it's already flagged. `POST …/flags/seen` marks the instructor's answers read |
| GET    | `/api/courses/:id/my-cases/:caseId/investigator` | | `{ investigations: [{ id, assignment, askedBy, sentAt, status, completedAt, report, unlocked, seen }] }`, the team's requests to the background investigator, newest first. `status` is `working` (with him or the instructor) or `completed`; only completed ones have their `report` (the clean one, after review) and `unlocked` files. Students never see his draft or the rulings |
| POST   | `/api/courses/:id/my-cases/:caseId/investigator/requests` | `{ assignment }` (up to 4000 characters) | `201 { investigations }`; emails the investigator. His report goes to the instructor's review first. `409` without an investigator, before the investigate phase, once the case is closed, without a case world, or while the team's last request is still out (one at a time) |
| POST   | `/api/courses/:id/my-cases/:caseId/investigator/seen` | | `204`; marks the team's investigator reports read for this student |
| GET    | `/api/courses/:id/my-cases/:caseId/exchange` | | `{ exchange }`, or `{ exchange: null }` until the setup is finished and the team is matched: `{ phase, requestsOpen, side, teamNumber, opponentNumber, firm, disclosures, subpoenas, interrogatories, rfas }`. `disclosures` (null when not included) is `{ open, options, submission, review }`, where `review` (after the introduction phase) is `{ matched, extra, missing }` against the instructor's picks. `subpoenas` (null when not included) is `{ types, limit, days, used, remaining, served, notices }`: `types` are the kinds of request the case allows, `served` are the team's own, `[{ id, recipient, recipientDescription, requestType, records, sentBy, sentAt, dueAt, outcome, response, respondedAt, documents: [{ materialId, title }], seen }]` (`outcome` is `responded` or `denied` once the instructor has reviewed it, and nothing of the draft shows before then), and `notices` the other team's in the case world, `[{ id, teamNumber, recipient, requestType, records, sentAt }]`, without what came back. Each other part (null when not included) is `{ limit, days, used, remaining, requests }`; each request has `direction` (`sent` / `received`), `seen`, `dueAt`, and `items: [{ position, text, weight, answer, objection, admission, agreePart, disagreePart }]` |
| POST   | `/api/courses/:id/my-cases/:caseId/exchange/disclosures` | `{ picks: [{ kind, id, reason }], heldBackReason }` | `201 { exchange }`; the student's own initial disclosures, once, from their side's options. Every pick needs a reason, and so does holding any back (`400`). `409` a second time or after the introduction phase. Practice only: they never change what the other side sees |
| POST   | `/api/courses/:id/my-cases/:caseId/exchange/requests` | `{ kind: 'interrogatories' \| 'rfas', items: string[] }` | `201 { exchange }`; sends a set (up to 50 items, 1000 characters each) to the other team, due in the part's `days`. Each lettered subpart, like "(a)", counts as its own interrogatory. `409` in the introduction phase, past the team's limit, or once the case is closed |
| POST   | `/api/courses/:id/my-cases/:caseId/exchange/requests/:requestId/responses` | `{ responses: [{ position, answer, objection, admission, agreePart, disagreePart }] }` | `{ exchange }`; the team's responses to a set it received, all at once and once (`409` again). Each interrogatory needs an answer, or with `objection` its grounds; each request for admission needs `agree`, `disagree`, or `partial` with both parts |
| POST   | `/api/courses/:id/my-cases/:caseId/exchange/subpoenas` | `{ recipient, recipientDescription, requestType, records }` | `201 { exchange }`; serves a subpoena (recipient up to 200 characters, who they are up to 1000, records up to 4000; `requestType` is `documents`, `esi`, `tangible_things` or `inspection`, one the case allows, and may be left out when it allows only one), due in the subpoena part's `days`, and starts the AI drafting the recipient's response. `400` for a kind the case doesn't allow; `409` in the introduction phase, past the team's limit, when the case leaves subpoenas out, or once the case is closed |
| POST   | `/api/courses/:id/my-cases/:caseId/exchange/seen` | | `204`; marks the responses to the team's sets, and the answers to its subpoenas, read for this student |
| PUT    | `/api/courses/:id/my-cases/:caseId/tasks/:taskId` | `{ done: boolean }`   | `{ workspace }`; marks it done (or not) for the student's whole team. `409` if the case is closed or the student has no team |
| GET    | `/api/courses/teaching` |                                | Instructors: `{ courses }` they teach, with `entryCode` and `studentCount` |
| GET    | `/api/courses/shared-cases` | | Instructors: `{ shares: [{ id, caseTitle, summary, fromName, fromEmail, sharedAt, includeTasks }] }`, cases other instructors shared with them, newest first |
| POST   | `/api/courses/shared-cases/:shareId/accept` | `{ courseId }` | `201 { courseId, case }`; copies the case into one of the instructor's classes (`404` for a class they don't teach, or a share that isn't theirs) and the share is done |
| POST   | `/api/courses/shared-cases/:shareId/decline` | | `204`; the share is gone |
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
| GET    | `/api/courses/:id/cases`                     |                                  | `{ cases: [{ id, title, summary, status, phase, importantFacts, setupStep, setupCompletedAt, createdAt, updatedAt }] }`, oldest first. `setupStep` is the furthest step of the guided setup reached, and `setupCompletedAt` is null until it's finished. `importantFacts` is `{ plaintiff: string[], defense: string[] }`: the most important facts for each side, which the AI witnesses never contradict and students never see |
| POST   | `/api/courses/:id/cases`                     | `{ title, summary, status?, importantFacts? }` | `201 { case }`, starting the guided setup; status defaults to `draft`. `summary` (the description) is required. `importantFacts` may be left out or have empty sides for now (at most 20 per side, each up to 500 characters); launching needs one per side |
| GET    | `/api/courses/:id/cases/:caseId`             |                                  | `{ case }` |
| PATCH  | `/api/courses/:id/cases/:caseId`             | `{ title, summary, status, importantFacts? }` | `{ case }`; status is required here. Without `importantFacts` they're kept; a case that isn't a draft must keep at least one per side |
| PUT    | `/api/courses/:id/cases/:caseId/setup`       | `{ step }`                       | `{ case }`; the guided setup reached `step` (`details`, `facts`, `files`, `teams`, `worlds`, `witnesses`, `tasks`). The furthest step is kept |
| POST   | `/api/courses/:id/cases/:caseId/setup/complete` |                               | `{ case }` with `setupCompletedAt`; the case page shows its tabs (and the student view) from then on. Cases made before the guided setup count as finished |
| DELETE | `/api/courses/:id/cases/:caseId`             |                                  | `204` |
| GET    | `/api/courses/:id/cases/:caseId/teams`       |                                  | `{ teams: [{ id, number, members }], unpaired, matchups: [{ id, number, plaintiffTeamId, defenseTeamId }] }` (members and unpaired are roster entries). Every team and matchup change responds with this shape |
| POST   | `/api/courses/:id/cases/:caseId/teams`       | `{ emails: string[] }` (1–3)     | `201`, the teams; `400` not on the roster, `409` already on a team |
| POST   | `/api/courses/:id/cases/:caseId/teams/auto`  | `{ teamSize? }` (2–6, default 2) | The teams, after grouping the students not on a team into teams of exactly `teamSize` at random; students left over stay off a team for the instructor to place. `400` for a bad size, `409` if nobody (or too few) are left |
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
| PUT    | `/api/courses/:id/cases/:caseId/materials/:materialId/shares` | `{ matchupIds, teamIds }` | `{ material }`; also shows the file to these case worlds (both teams) and teams, whatever its `audience` ("Instructors only" plus shares means just them). Every material carries `shares: { matchupIds, teamIds }` |
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
| PUT    | `/api/courses/:id/cases/:caseId/phase` | `{ phase }`                                  | `{ case }`; moves every case world to `introduction`, `information_exchange`, `investigate`, or `deposition` (forward or back). Leaving `introduction` shares the instructor's disclosed files with both sides, and going back to it un-shares them. `409` once the case is closed, for `information_exchange` before its setup is finished, or for `investigate` in a case without an investigator |
| GET    | `/api/courses/:id/cases/:caseId/exchange` |                                 | `{ settings, options }`. `settings` is `{ setupCompletedAt, disclosures: { enabled, materialIds, witnessIds }, subpoenas, interrogatories, rfas, firms }`, with each part `{ enabled, limit, days }` (subpoenas also have `types`, the kinds of request allowed) and `firms` `{ plaintiff, defense }`, each `{ firm, partner }` (the defaults until saved). `options` is what each side could disclose: `[{ kind, id, side, name, detail, avatarUrl }]`, its own witnesses and one-side case files (never the initial file) |
| PUT    | `…/exchange`                                 | `{ disclosures: { enabled }, subpoenas, interrogatories, rfas, firms }` | `{ settings }`. Limits 1–100, days 1–365, names up to 120 characters, and at least one subpoena type (all four when `types` is left out); `400` otherwise. |
| PUT    | `…/exchange/disclosures`                     | `{ materialIds, witnessIds }`    | `{ settings }`; the instructor's initial disclosures (the answer key), each one of the `options` (`400` otherwise). Outside the introduction phase they're shared at once |
| POST   | `…/exchange/complete`                        |                                  | `{ settings, case }`; finishes the setup (once): students see the exchange, and the case gains its information exchange phase |
| GET    | `…/exchange/overview`                        |                                  | `{ overview: { submissions: { submitted, total, byWorld }, activity: { interrogatoriesSent, rfasSent, teams, teamsSentInterrogatories, teamsSentRfas, waiting, overdue, subpoenasServed, subpoenasWaiting }, disclosed: { materials, witnesses } } }` |
| GET    | `…/exchange/requests`                        |                                  | `{ requests }`: every set the teams have sent each other, newest first, with the responses (read-only) |
| PUT    | `/api/courses/:id/cases/:caseId/investigator` | `{ enabled, name, instructions }` | `{ case }` with `investigator: { enabled, name, instructions }`. Every case starts with one, named John Hastings; a blank name goes back to that. `instructions` (up to 2000 characters) go into his prompt. Without him the case has no investigate phase, so he can't be turned off during it (`409`) |
| GET    | `/api/courses/:id/subpoenas?status=open\|completed` | | `{ subpoenas }` to answer (soonest due first) or answered: `{ id, caseId, caseTitle, parties, firm, worldNumber, teamNumber, side, team, recipient, recipientDescription, requestType, records, sentBy, sentAt, dueAt, outcome, response, respondedAt, respondedBy, documents, status, draft, flag, existing, basedOn, unknownTitles, instructions, createNew, error }`. `status` is `drafting`, `open` (the draft is ready), `failed` or `answered`; `flag` is `quash` or `modify` when the AI thinks a court would step in; `existing` are case files the draft produces (`producedToTeam` when one is an earlier subpoena's response); `basedOn` is `{ materialId, title, worldNumber }`, another case world's response the draft adapts. Open ones count toward the home page's `reviewCount` |
| POST   | `/api/courses/:id/subpoenas/:subpoenaId/approve` | `{ response }` | `{ subpoena }`; sends the team the response. When the draft produces `existing` case files, the team gets just those files (no `response` needed or kept). Otherwise the response, as drafted or edited (up to 60,000 characters), becomes a case file of the team's case world (`source: 'subpoena'`), shared with the team. `409` while drafting or once answered |
| POST   | `/api/courses/:id/subpoenas/:subpoenaId/deny` | `{ note }` | `{ subpoena }`; denies it, with an optional note for the team; nothing is produced, and it still counts toward the team's limit |
| POST   | `/api/courses/:id/subpoenas/:subpoenaId/redraft` | `{ instructions, createNew }` | `{ subpoena }`, drafting; the AI drafts the response again with the instructor's notes (`createNew`: as a new file, not existing ones). Also retries a failed draft. `409` while drafting or once answered |
| GET    | `/api/courses/:id/cases/:caseId/facts` | | `{ facts: { fileFacts: { status, facts }, important, allWorlds: { accepted, denied }, worlds: [{ matchupId, number, teams, accepted, denied }] } }`, the running list of facts; each ruled fact is `{ text, source, auto }`. Starts reading the case files again if they changed. `POST …/facts/refresh` reads them again regardless |
| PUT    | `/api/courses/:id/cases/:caseId/review-mode` | `{ reviewMode }` | `{ case }`; `all` (review everything) or `lite` |
| GET    | `/api/courses/:id/reviews?status=open\|completed` | | `{ reviews }` to do (including `summarizing`, `failed` and `finalizing`) or completed: `{ id, kind, caseTitle, witness, worldNumber, teamNumber, side, team, status, error, createdAt, completedAt, facts: [{ id, text, decision }] }`. `kind` is `interview` or `investigation`; an investigation has no witness, and adds `assignment`, `askedBy`, `report`, `finalReport`, `recordsRequested`, and `documents: [{ materialId, title, decision, auto }]`. Facts also have `groupId` and `auto`. The open list comes with `groups` (similar facts to rule on together: `{ id, caseId, headline, differences, facts, worlds }`) and `flags` (students' flags, each with its `review` or `subpoena`) |
| PUT    | `/api/courses/:id/reviews/fact-groups/:groupId` | `{ decision }` | Rules on every fact in the group, `_world` each for its own world. `POST …/ungroup` sends them back to their reviews |
| POST   | `/api/courses/:id/reviews/flags/:flagId/resolve` | `{ decision }` or `{ action }` | Answers a flag: a fact's ruling (`accept_world` keeps it), a file's `allow` (keep) or `deny` (take it back), or a subpoena's `keep` or `reopen` (its answer is taken back and it waits for review) |
| PUT    | `/api/courses/:id/reviews/:reviewId/facts/:factId` | `{ decision }` | `{ review }`; `accept_world`, `deny_world`, `accept_case`, or `deny_case`. Ruling the last thing finishes the review; a finished one's rulings can be changed. `409` for a fact in a group (rule on the group) |
| PUT    | `/api/courses/:id/reviews/:reviewId/documents/:materialId` | `{ decision }` | An investigation's case file: `allow` (it's shared with the team once the review is done) or `deny` (it comes out of the report) |
| POST   | `/api/courses/:id/reviews/:reviewId/complete` \| `/retry` | | `{ review }`; complete sends on a review with nothing to rule on (`409` otherwise; the rest finish once ruled). An investigation then goes to `finalizing` while the AI writes the team's clean report, and to `completed` when it's done. Retry is for a `failed` review, and picks up at the step that failed |
| GET    | `/api/courses/:id/reviews/:reviewId/transcript` | | `{ turns: [{ question, objection, answer, askedBy }] }` |
| GET    | `/api/courses/:id/cases/:caseId/launch` |                                             | `{ checks: [{ key, ok, message }] }`: important facts for both sides, everyone paired, every team matched, an initial case file chosen |
| POST   | `/api/courses/:id/cases/:caseId/launch` |                                             | `{ case }`, now `active`; `409` if not ready (the message lists what's missing) or already launched |
| POST   | `/api/courses/:id/cases/:caseId/duplicate` | `{ courseId, includeTasks, title }` | `201 { courseId, case }`; copies the case into a class the instructor teaches (this one when `courseId` is left out; `404` otherwise) |
| POST   | `/api/courses/:id/cases/:caseId/share` | `{ email, includeTasks }` | `201 { share: { toName, toEmail } }`; shares it with that instructor, who accepts or declines it. `404` when no one has that email; `400` for a student's email or your own |
| GET    | `/api/courses/:id/cases/:caseId/preview?side=&matchup=` |                             | `{ workspace }`: the case dashboard as a team on `side` sees it (that world's team, with `matchup`), with `preview: true` |

All `/api/courses` routes return `401` when not logged in.

**Cases** are shared by the whole class. A case's `status` is `draft` (hidden from students), `active`, or `closed`. Students are put into **teams** per case: auto-pair makes teams of the size the instructor chooses (2 to 6), and anyone left over stays off a team for the instructor to place (a team holds up to 7). Instructors can also drag students between teams, and drag teams into a new case world's Plaintiff and Defense slots. Team members are roster entries, so pending students can be paired too, and removing a student from the roster takes them off their teams. Auto-pairing avoids repeating partners from the course's other cases where it can. Each **matchup** sets two teams against each other as plaintiff and defense, and is one **case world** (matchup `number` 1 is World A). The side is stored on the matchup, not the team. Auto-matching avoids opponents students faced in the course's other cases and gives each team the side its members have argued less. Deleting a team deletes its matchup. A closed case's teams and matchups can't change (`409`).

Every case also has a **phase**, shared by all of its case worlds and set by the instructor: `introduction`, `information_exchange`, `investigate`, then `deposition`. New cases start in `introduction`. A case has the information exchange phase only once its setup is finished, and the investigate phase only with a background investigator (`investigator.enabled`); otherwise it skips them. Before `deposition`, a witness who testifies for one side (`alignedSide`) is hidden from the other side's teams, so they can neither see nor interview them, except that from `information_exchange` on, the witnesses the instructor disclosed are shown to the other side (marked `disclosed`, and not yet open to interviews); other witnesses follow their `audience`. From `investigate` on, the background investigator is open (`investigatorAvailable` on the student's case dashboard).

**Duplicating and sharing.** An instructor can duplicate a case into any class they teach (next year's, say), or share it with another instructor by email; that instructor sees it on their home page and declines it, or accepts it into one of their classes. Either way the copy is the case as written: details, important facts, the background investigator, witnesses (their pictures, deposition files and the files they know), every case file with the text the AI already read from it (so nothing is read again), the information exchange setup to finish again, and, if chosen, the tasks without their due dates. Every file becomes instructors-only, except the starting file. Teams, worlds, and everything from playing the case (interviews, rulings on facts, requests, subpoenas and their responses, shared files) stay behind. The copy is a draft in the introduction phase, and its guided setup is only its teams and worlds, from the new class's roster (`cases.copy_setup`). The code is in `server/courses/caseCopy.ts`.

**Information exchange** has its own guided setup on the case's Information exchange tab: which parts the case includes (initial disclosures, subpoenas, interrogatories, requests for admission), each team's limit and the days the other side has to respond, the instructor's initial disclosures for each side (the answer key: that side's witnesses and one-side case files), and the firm and senior partner who sign each side's welcome email. Its review step warns when a side has no disclosures picked (or nothing to pick from) or an email has no firm or partner, but doesn't stop the instructor finishing. Students see none of it until the setup is finished. In `introduction`, each team gets the welcome email, and each student picks their own initial disclosures, with a reason for each (practice, shown as a task on their dashboard). Moving to `information_exchange` shares the instructor's disclosed files with both sides (their `audience` becomes `all`, and goes back if the case returns to `introduction`), shows each student how their picks compare, and opens subpoenas, interrogatories, and requests for admission. Interrogatories and requests for admission go between the two teams in each case world; each set a team receives is a task due on the set's due date. A **subpoena** goes to a person or organization (a hospital, a regulator), not the other team, for one kind of thing the instructor allows (documents, ESI, tangible things, or an inspection of premises). The team names the recipient, says who they are, and writes what it wants, seeing it fill in on a copy of the federal form (AO 88B; the court's details are made up per case). The AI then drafts the recipient's response from the whole case file of the team's case world (`server/exchange/templates/subpoena-response.md` for the rules and case file, cached once for every subpoena in a case world, and `subpoena-request.md` for the subpoena itself; the `CLAUDE_SUBPOENA_MODEL` step), flagging when a court would likely quash or modify it and producing existing case files where they already answer it. It reuses earlier responses in this order: a file already in this world's case file, including a response the other team got for the same or a substantially similar subpoena (offered as the file to send); then a response approved in another case world, adapted to this subpoena as a new document (the instructor sees which one to compare); and only then records made from scratch. The instructor reviews the draft on the Review page: send it (editing it first, or sending the existing files), have it redrafted with notes, or deny the subpoena. An approved response that produces existing case files sends the team just those files; otherwise it becomes a case file of that case world (a **Subpoena Response**), shared with the team. Each case file records its source, **Instructor Uploaded** or **Subpoena Response**, shown and filterable on the case's Case file tab. The AI's case file is every instructor-uploaded file plus the requesting team's own world's subpoena responses, never another world's, so later witnesses, investigations and subpoenas in that world stay consistent with them. The other team in the world gets notice of each subpoena (who and what, as FRCP 45(a)(4) requires) but never what came back. The code is in `server/exchange/`.

**The background investigator** is the same character for every team in a case (John Hastings by default, `public/investigator.png`). A team emails him an assignment; in the background the AI writes his report from `server/investigator/templates/investigator.md`, filled in with every case file (marked with whether the team has it), the important facts, the facts accepted and denied for the team's world, the instructor's instructions, and the team's earlier assignments and reports. He may watch named witnesses and parties from public places, within the real-life limits the template spells out (no private spaces, trackers, or recording without consent; nothing that could be stalking or witness tampering), and never contacts them; when he can't do exactly what was asked, he offers the closest lawful substitute, such as an estimate or range from typical figures, labelled as one. Every report goes to the Review page (except in review lite, below), even with nothing to rule on, with its new facts (ruled on like an interview's) and any case files he could get for the team (allow or not), plus records that need legal process; the instructor reads it without its source tags, and a report missing its list of new facts and files is flagged. When the instructor finishes, the AI writes the clean report the team gets, leaving out denied facts and anything from a file that wasn't allowed; the allowed files are shared with the team. The team sees only that report, with the allowed files attached, in its Investigator tab and case file, with a notice until they read it. In `deposition`, every witness is revealed to both sides, and a team can depose the other side's AI witnesses, always as its own side.

Each case also has a **case file** (the pieces of the fact pattern: documents, images, audio, and video, told apart only by file type), **witnesses**, **tasks**, and an instructor note. Every material, witness, and task has an `audience`: everyone in the case, or only the plaintiff or defense teams; students see shared items plus their side's (only shared items before their team is matched). Teams mark tasks done, and their progress is the share of tasks done. **Launching** a draft case (`POST …/launch`) makes it active once both sides have important facts, everyone is paired, every team is matched, and the case file has its initial file.

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

**Costs.** Each AI step uses the model in `CLAUDE_MODEL` (default `claude-haiku-5-5`, the cheapest); set `CLAUDE_WITNESS_MODEL`, `CLAUDE_INVESTIGATOR_MODEL`, `CLAUDE_SUBPOENA_MODEL`, `CLAUDE_TRANSCRIBE_MODEL`, `CLAUDE_REVIEW_MODEL`, or `CLAUDE_EVAL_MODEL` to change one step, and restart the server. To keep costs down:
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

For each new fact the instructor chooses **accept for this world**, **deny for this world**, **accept for all worlds**, or **deny for all worlds**; the review is done once everything in it is ruled (a report with nothing to rule on has a **Send to Team N** button instead). Rulings can still be changed afterwards from **Completed reviews**: an interview's struck transcript follows, and an investigator report is rewritten. From then on, every witness prompt for that world (or every world, for the case-wide rulings) lists the accepted facts as settled and the denied ones as things that aren't true (`server/reviews/reviews.ts`, `settledFacts`). The team gets a notice and a **Reviews** tab in the case showing each fact only as *Accepted* or *Denied*. Rulings are stored in `interview_reviews` and `review_facts`; there is no vector store, since the whole case file already goes into each prompt.

**Similar facts are grouped.** Whenever a review opens, Claude looks over every fact still waiting for a ruling in the case and groups the ones that make the same or a highly similar claim, from different teams (`server/reviews/grouping.ts` and `factsAi.ts`, the `CLAUDE_REVIEW_MODEL` step): "Teams 1 and 2, interviewing Paige, both got estimates of medical expenses", with the differences ("$6,000 vs. $8,000"). A group is ruled at once, **for these N worlds** (each fact in its own world) or for all worlds, with each source conversation or report a click away; **Ungroup** sends the facts back to their reviews to rule on one by one, never to be grouped again.

**The running list of facts** sits beside the queue, for one case at a time: what the instructor's case files say (read by Claude in the background and again whenever the files change, `server/reviews/caseFacts.ts`), the important facts for each side, what's ruled for all worlds, and a card for each world. Every review card also opens its own world's card.

**Review lite.** The facts panel switches a case between **Review everything** (the default) and **Review lite** (`cases.review_mode`). In review lite nothing waits for the instructor: an interview's new facts are accepted for the team's world, an investigator's facts stand for the world and his files are allowed, and a subpoena's first draft is sent (denied with its objections when the AI would quash it, sent narrowed when it would modify it). Nothing automatic ever applies to all worlds, and each call is marked `auto`. Students can **flag** any of these for the instructor (an accepted fact, a file, a subpoena's answer, or **appeal** a denial) with a reason (`server/reviews/flags.ts`); flags come first on the Review page, laid out as the item would have been for review, and the instructor keeps the call or changes it: rules on the fact again, takes the file back, or reopens the subpoena to answer it again. The team sees whether their flag was kept or changed. Switching modes affects only what comes in afterwards.

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
