import { pool } from '../db/pool.ts'

export type Role = 'student' | 'instructor'

// Shape sent to the client; matches `User` in src/auth/types.ts.
export interface PublicUser {
  id: string
  name: string
  email: string
  role: Role
  createdAt: string
}

interface UserRow {
  id: string
  name: string
  email: string
  role: Role
  password_hash: string
  created_at: Date
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    createdAt: row.created_at.toISOString(),
  }
}

export async function findUserById(id: string) {
  const { rows } = await pool.query<UserRow>('SELECT * FROM users WHERE id = $1', [id])
  return rows[0] ?? null
}

export async function findUserByEmail(email: string) {
  const { rows } = await pool.query<UserRow>(
    'SELECT * FROM users WHERE lower(email) = lower($1)',
    [email],
  )
  return rows[0] ?? null
}

/** Returns null if the email is already taken. */
export async function createUser(input: {
  name: string
  email: string
  role: Role
  passwordHash: string
}) {
  const { rows } = await pool.query<UserRow>(
    `INSERT INTO users (name, email, role, password_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT ((lower(email))) DO NOTHING
     RETURNING *`,
    [input.name, input.email, input.role, input.passwordHash],
  )
  return rows[0] ?? null
}
