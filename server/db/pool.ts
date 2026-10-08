import pg from 'pg'
import { isProduction } from '../config.ts'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Add it to .env.local (see README).')
}

export const pool = new pg.Pool({
  connectionString,
  // Heroku Postgres requires SSL but uses certificates Node doesn't trust by default.
  ssl: isProduction ? { rejectUnauthorized: false } : undefined,
})
