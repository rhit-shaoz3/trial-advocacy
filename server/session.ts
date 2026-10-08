import connectPgSimple from 'connect-pg-simple'
import session from 'express-session'
import { isProduction } from './config.ts'
import { pool } from './db/pool.ts'

declare module 'express-session' {
  interface SessionData {
    userId: string
  }
}

const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

function readSessionSecret() {
  const secret = process.env.SESSION_SECRET
  if (secret) return secret
  if (isProduction) {
    throw new Error('SESSION_SECRET must be set in production.')
  }
  console.warn('SESSION_SECRET not set; using an insecure development secret.')
  return 'dev-only-insecure-secret'
}

const PgStore = connectPgSimple(session)

export const sessionMiddleware = session({
  store: new PgStore({ pool, tableName: 'session' }),
  name: 'ta.sid',
  secret: readSessionSecret(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: SESSION_MAX_AGE_MS,
  },
})
