import express, { type ErrorRequestHandler } from 'express'
import { fileURLToPath } from 'node:url'
import { authRouter } from './auth/routes.ts'
import { isProduction } from './config.ts'
import { coursesRouter } from './courses/routes.ts'
import { HttpError } from './httpError.ts'
import { sessionMiddleware } from './session.ts'

export const app = express()

// Heroku terminates HTTPS at its router; trust it so secure cookies work.
if (isProduction) app.set('trust proxy', 1)

app.use('/api', express.json(), sessionMiddleware)
app.use('/api/auth', authRouter)
app.use('/api/courses', coursesRouter)

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found.')))

// In production the API also serves the built React app from dist/.
if (isProduction) {
  const distDir = fileURLToPath(new URL('../dist', import.meta.url))
  app.use(express.static(distDir))
  app.get('/{*splat}', (_req, res) => res.sendFile('index.html', { root: distDir }))
}

// Express only treats a handler as an error handler if it takes four arguments.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message })
    return
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Request body is not valid JSON.' })
    return
  }
  console.error(err)
  res.status(500).json({ error: 'Something went wrong. Please try again.' })
}
app.use(errorHandler)
