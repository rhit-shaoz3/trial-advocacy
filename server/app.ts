import express, { type ErrorRequestHandler } from 'express'
import multer from 'multer'
import { fileURLToPath } from 'node:url'
import { authRouter } from './auth/routes.ts'
import { casesRouter, MAX_FILE_MB } from './cases/routes.ts'
import { classesRouter } from './classes/routes.ts'
import { isProduction } from './config.ts'
import { HttpError } from './httpError.ts'
import { sessionMiddleware } from './session.ts'

export const app = express()

// Heroku terminates HTTPS at its router; trust it so secure cookies work.
if (isProduction) app.set('trust proxy', 1)

app.use('/api', express.json(), sessionMiddleware)
app.use('/api/auth', authRouter)
app.use('/api/classes', classesRouter)
app.use('/api/cases', casesRouter)

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found.')))

// In production the API also serves the built React app from dist/.
if (isProduction) {
  const distDir = fileURLToPath(new URL('../dist', import.meta.url))
  app.use(express.static(distDir))
  app.get('/{*splat}', (_req, res) => res.sendFile('index.html', { root: distDir }))
}

function uploadErrorMessage(err: multer.MulterError) {
  switch (err.code) {
    case 'LIMIT_FILE_SIZE':
      return `Files must be ${MAX_FILE_MB} MB or smaller.`
    case 'LIMIT_FILE_COUNT':
      return 'Too many files at once. Upload them in smaller batches.'
    default:
      return 'The upload could not be read. Please try again.'
  }
}

// Express only treats a handler as an error handler if it takes four arguments.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message })
    return
  }
  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: uploadErrorMessage(err) })
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
