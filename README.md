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

5. Start the API and the web app together:

   ```bash
   npm run dev
   ```

Then open the URL Vite prints (usually http://localhost:5173). Vite forwards `/api` requests to the API on port 3001.

## Scripts

| Command              | What it does                                         |
| -------------------- | ---------------------------------------------------- |
| `npm run dev`        | Start the API and web app with hot reload            |
| `npm run dev:client` | Start only the Vite dev server                       |
| `npm run dev:server` | Start only the API (restarts on file changes)        |
| `npm run db:migrate` | Apply `server/db/schema.sql` to the database         |
| `npm run build`      | Type-check everything and build the web app (`dist/`) |
| `npm start`          | Run the API in production (also serves `dist/`)      |
| `npm test`           | Run all tests once                                   |
| `npm run test:watch` | Re-run tests as files change                         |
| `npm run lint`       | Run ESLint                                           |

## Testing

Tests use [Vitest](https://vitest.dev) and live next to the code they test (`*.test.ts(x)`):

- **`server/**/*.test.ts`**: API tests that send real HTTP requests to the Express app and use a real Postgres database.
- **`src/**/*.test.tsx`**: UI tests that render the React pages in a simulated browser against a fake auth service.

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
| POST   | `/api/auth/signup` | `{ name, email, password, role, classCode? }` | `201 { user }`, `409` if email taken, `404` if `classCode` matches no class |
| POST   | `/api/auth/login`  | `{ email, password }`               | `{ user }`, `401` if wrong |
| POST   | `/api/auth/logout` |                                     | `204`                     |

### Classes

All of these need a logged-in user. "Instructor" routes only work on classes that instructor teaches.

| Method | Path | Who | Body | Result |
| ------ | ---- | --- | ---- | ------ |
| GET    | `/api/classes` | both | | `{ classes }`: an instructor gets each class with its join code, students, invitations and pending requests; a student gets the classes they're in |
| POST   | `/api/classes` | instructor | `{ name, studentEmails }` | `201 { class, invited, withAccounts }`; creates a name-based join code (e.g. `EVID517`) and invites the emails |
| POST   | `/api/classes/:id/requests` | instructor | `{ userIds, decision: 'admit' \| 'deny' }` | `{ updated }` |
| POST   | `/api/classes/join` | student | `{ code }` | `{ status: 'requested' \| 'enrolled', className }`, `404` if no class has that code |
| GET    | `/api/classes/inbox` | student | | `{ invitations, pendingRequests, denials }` |
| POST   | `/api/classes/invitations/:id/accept` | student | | `204`, joins the class |
| POST   | `/api/classes/invitations/:id/reject` | student | | `204`, removes the invitation |
| POST   | `/api/classes/denials/:classId/dismiss` | student | | `204`, clears a "request denied" notice |

### Cases

A case belongs to a class. Instructors add documents, characters (witnesses), teams and matchups, then publish each section to students separately. Only the class's instructors can see or change a case; students see it once something is published.

| Method | Path | Who | Body | Result |
| ------ | ---- | --- | ---- | ------ |
| GET    | `/api/cases` | both | | `{ cases }`: an instructor gets every case in their classes; a student gets published cases in classes they're in |
| POST   | `/api/cases` | instructor | `{ name, classId }` | `201 { case }` |
| GET    | `/api/cases/:id` | both | | `{ case }`: everything for the instructor; for a student, only published sections, filtered to their side |
| PATCH  | `/api/cases/:id/publish` | instructor | `{ documents?, characters?, teams? }` (booleans) | `{ case }` |
| POST   | `/api/cases/:id/documents` | instructor | multipart: `files` (up to 20, 20 MB each), `side` | `201 { documents }` |
| PATCH  | `/api/cases/:id/documents/:docId` | instructor | `{ side }` | `{ document }` |
| DELETE | `/api/cases/:id/documents/:docId` | instructor | | `204` |
| GET    | `/api/cases/:id/documents/:docId/file` | both | | the file, as a download |
| POST   | `/api/cases/:id/characters` | instructor | `{ name, title, role, side }` | `201 { character }` |
| PATCH / DELETE | `/api/cases/:id/characters/:charId` | instructor | `{ name, title, role, side }` | `{ character }` / `204` |
| PUT / DELETE | `/api/cases/:id/characters/:charId/documents/:docId` | instructor | | `204`; links or unlinks what the character knows |
| PUT    | `/api/cases/:id/teams` | instructor | `{ teams: [{ id?, name, side, studentIds }] }` | `{ case }`; replaces all teams; every student must be on one |
| PUT    | `/api/cases/:id/matchups` | instructor | `{ matchups: [{ plaintiffTeamId, defendantTeamId }] }` | `{ case }`; replaces all matchups |

A character's `title` is their job title (e.g. "Police Officer") and `role` is `witness` or `investigator`. `side` is `plaintiff`, `defendant` or `both` for documents and characters, and `plaintiff` or `defendant` for teams. Students see items marked `both` once that section is published, and items for their own side once teams are published too.

Uploaded files are stored in Postgres (the `stored_files` table) for now. Only `server/files/fileStore.ts` touches that table, so moving to S3 means replacing that one file.

Errors come back as `{ error: "message" }`. Logins are kept in an httpOnly session cookie stored in the `session` table.

## Deploying to Heroku

The `Procfile` runs migrations on each release and starts the API, which also serves the built frontend. One-time setup:

```bash
heroku addons:create heroku-postgresql:essential-0
heroku config:set SESSION_SECRET=<long random string>
```
