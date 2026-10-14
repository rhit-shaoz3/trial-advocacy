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

## API

| Method | Path               | Body                                | Result                    |
| ------ | ------------------ | ----------------------------------- | ------------------------- |
| GET    | `/api/auth/me`     |                                     | `{ user }` or `{ user: null }` |
| POST   | `/api/auth/signup` | `{ name, email, password, role, classCode? }` (a course's entry code; students ask to join it) | `201 { user }`, `409` if email taken |
| POST   | `/api/auth/login`  | `{ email, password }`               | `{ user }`, `401` if wrong |
| POST   | `/api/auth/logout` |                                     | `204`                     |
| GET    | `/api/courses`     |                                     | `{ courses }` the user has joined, newest term first |
| POST   | `/api/courses/join`| `{ entryCode }`                     | `201 { course, status }`: `requested` (the instructor admits or denies) or `joined` (if they'd been invited); `404` unknown code, `409` already joined or already asked, `403` instructors |
| GET    | `/api/courses/inbox` |                                   | Students: `{ invitations, pendingRequests, denials }`, each `[{ courseId, courseName }]` |
| POST   | `/api/courses/:id/invitation/accept` |                   | `204`; joins the course |
| POST   | `/api/courses/:id/invitation/reject` |                   | `204`; takes the email off the roster |
| POST   | `/api/courses/:id/denial/dismiss` |                      | `204`; clears a "request denied" notice |
| GET    | `/api/courses/:id/home` |                                | Enrolled students (and the instructor): `{ course, cases, activity, upcoming, stats }` for the course home page. `cases` are the course's case cards (students only see released ones); activity and deadlines aren't stored yet, so those lists are empty for now |
| GET    | `/api/courses/teaching` |                                | Instructors: `{ courses }` they teach, with `entryCode`, `studentCount`, `requestCount` and `invitedCount` |
| POST   | `/api/courses`     | `{ code, title, season, year }`     | Instructors: `201 { course }` with a new entry code |

These manage one course and are only for the instructor who teaches it (anyone else gets `404`):

| Method | Path                                         | Body / headers                   | Result |
| ------ | -------------------------------------------- | -------------------------------- | ------ |
| GET    | `/api/courses/:id`                           |                                  | `{ course }` |
| PATCH  | `/api/courses/:id`                           | `{ code, title, season, year }`  | `{ course }`; entry code and roster unchanged |
| DELETE | `/api/courses/:id`                           |                                  | `204`; also deletes the roster and fact patterns |
| GET    | `/api/courses/:id/roster`                    |                                  | `{ roster: [{ email, name, userId, status }] }`, status `joined`, `requested` or `invited` |
| POST   | `/api/courses/:id/roster`                    | `{ emails: string[] }`           | Invites them: `{ added, skipped: [{ email, reason }], roster }` |
| POST   | `/api/courses/:id/roster/requests`           | `{ userIds, decision: 'admit' \| 'deny' }` | `{ updated, roster }` for students who asked to join |
| DELETE | `/api/courses/:id/roster/:email`             |                                  | `204`, `404` if not on the roster |
| GET    | `/api/courses/:id/fact-patterns`             |                                  | `{ factPatterns: [{ id, filename, sizeBytes, uploadedAt }] }` |
| POST   | `/api/courses/:id/fact-patterns`             | Raw file body; `X-Filename` (URI-encoded) | `201 { factPattern }`; `413` over 10 MB, `415` not PDF/Word/text |
| GET    | `/api/courses/:id/fact-patterns/:fileId/file` |                                 | The file, as a download |
| DELETE | `/api/courses/:id/fact-patterns/:fileId`     |                                  | `204` |

### Cases

A course's instructor builds each case (files, characters, teams, match-ups) and releases each section to students separately. Students only see cases with something released.

| Method | Path | Who | Body | Result |
| ------ | ---- | --- | ---- | ------ |
| GET    | `/api/cases` | both | | `{ cases }` across all the user's courses; students only get cases with something published |
| GET    | `/api/courses/:id/cases` | members | | `{ cases }`; students only get cases with something published |
| POST   | `/api/courses/:id/cases` | instructor | `{ name }` | `201 { case }` |
| GET    | `/api/cases/:caseId` | members | | `{ case }`: everything for the instructor; for a student, only published sections, filtered to their side |
| PATCH  | `/api/cases/:caseId/publish` | instructor | `{ documents?, characters?, teams? }` (booleans) | `{ case }` |
| POST   | `/api/cases/:caseId/documents?side=` | instructor | Raw file body; `X-Filename` (URI-encoded), same rules as fact patterns | `201 { document }` |
| PATCH / DELETE | `/api/cases/:caseId/documents/:docId` | instructor | `{ side }` | `{ document }` / `204` |
| GET    | `/api/cases/:caseId/documents/:docId/file` | members | | The file, as a download (students only get their side's and shared files) |
| POST   | `/api/cases/:caseId/characters` | instructor | `{ name, title, role, side }` | `201 { character }` |
| PATCH / DELETE | `/api/cases/:caseId/characters/:charId` | instructor | `{ name, title, role, side }` | `{ character }` / `204` |
| PUT / DELETE | `/api/cases/:caseId/characters/:charId/documents/:docId` | instructor | | `204`; links or unlinks what the character knows |
| PUT    | `/api/cases/:caseId/teams` | instructor | `{ teams: [{ id?, name, side, studentIds }] }` | `{ case }`; replaces all teams; every joined student must be on one |
| PUT    | `/api/cases/:caseId/matchups` | instructor | `{ matchups: [{ plaintiffTeamId, defendantTeamId }] }` | `{ case }`; replaces all match-ups |

A character's `title` is their job title (e.g. "Police Officer") and `role` is `witness` or `investigator`. `side` is `plaintiff`, `defendant` or `both` for documents and characters, and `plaintiff` or `defendant` for teams. Students see items marked `both` once that section is published, and items for their own side once teams are published too.

All `/api/courses` and `/api/cases` routes return `401` when not logged in.

**Rosters are keyed by email, and nobody joins without both sides agreeing.** An instructor invites students by email (even before they have an account); each student accepts or rejects the invitation when they log in, and rejecting takes them off the roster. A student can instead enter the entry code (or a course code at sign-up), which asks to join; the instructor admits or denies, and a denied student sees a notice once. A student who was invited and then enters the code joins straight away.

Errors come back as `{ error: "message" }`. Logins are kept in an httpOnly session cookie stored in the `session` table.

## Deploying to Heroku

The `Procfile` runs migrations on each release and starts the API, which also serves the built frontend. One-time setup:

```bash
heroku addons:create heroku-postgresql:essential-0
heroku config:set SESSION_SECRET=<long random string>
```
