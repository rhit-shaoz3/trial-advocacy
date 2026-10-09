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

   Optionally add demo data (prints demo instructor and student logins, and course entry codes):

   ```bash
   npm run db:seed
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
| POST   | `/api/auth/signup` | `{ name, email, password, role }`   | `201 { user }`, `409` if email taken |
| POST   | `/api/auth/login`  | `{ email, password }`               | `{ user }`, `401` if wrong |
| POST   | `/api/auth/logout` |                                     | `204`                     |
| GET    | `/api/courses`     |                                     | `{ courses }` the user is enrolled in, newest term first |
| POST   | `/api/courses/join`| `{ entryCode }`                     | `201 { course }`; `404` unknown code, `409` already enrolled, `403` instructors |
| GET    | `/api/courses/teaching` |                                | Instructors: `{ courses }` they teach, with `entryCode` and `studentCount` |
| POST   | `/api/courses`     | `{ code, title, season, year }`     | Instructors: `201 { course }` with a new entry code |

These manage one course and are only for the instructor who teaches it (anyone else gets `404`):

| Method | Path                                         | Body / headers                   | Result |
| ------ | -------------------------------------------- | -------------------------------- | ------ |
| GET    | `/api/courses/:id`                           |                                  | `{ course }` |
| PATCH  | `/api/courses/:id`                           | `{ code, title, season, year }`  | `{ course }`; entry code and roster unchanged |
| DELETE | `/api/courses/:id`                           |                                  | `204`; also deletes the roster and fact patterns |
| GET    | `/api/courses/:id/roster`                    |                                  | `{ roster: [{ email, name, joined }] }` |
| POST   | `/api/courses/:id/roster`                    | `{ emails: string[] }`           | `{ added, skipped: [{ email, reason }], roster }` |
| DELETE | `/api/courses/:id/roster/:email`             |                                  | `204`, `404` if not on the roster |
| GET    | `/api/courses/:id/fact-patterns`             |                                  | `{ factPatterns: [{ id, filename, sizeBytes, uploadedAt }] }` |
| POST   | `/api/courses/:id/fact-patterns`             | Raw file body; `X-Filename` (URI-encoded) | `201 { factPattern }`; `413` over 10 MB, `415` not PDF/Word/text |
| GET    | `/api/courses/:id/fact-patterns/:fileId/file` |                                 | The file, as a download |
| DELETE | `/api/courses/:id/fact-patterns/:fileId`     |                                  | `204` |

All `/api/courses` routes return `401` when not logged in.

**Rosters are keyed by email.** An instructor can add a student who has no account yet; that roster row is "pending" until someone signs up with the email (or joins with the entry code), and then it links to their account automatically.

Errors come back as `{ error: "message" }`. Logins are kept in an httpOnly session cookie stored in the `session` table.

## Deploying to Heroku

The `Procfile` runs migrations on each release and starts the API, which also serves the built frontend. One-time setup:

```bash
heroku addons:create heroku-postgresql:essential-0
heroku config:set SESSION_SECRET=<long random string>
```
