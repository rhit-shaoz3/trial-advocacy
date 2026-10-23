import { pool } from '../db/pool.ts'

export type Role = 'student' | 'instructor'

/** The colour themes on the account page; navy and parchment by default. */
export const THEMES = ['navy', 'forest', 'lagoon', 'vivid', 'stone'] as const
export type Theme = (typeof THEMES)[number]

export const MAX_NAME_LENGTH = 100

// Shape sent to the client; matches `User` in src/auth/types.ts.
export interface PublicUser {
  id: string
  name: string
  email: string
  role: Role
  theme: Theme
  createdAt: string
}

export interface UserRow {
  id: string
  name: string
  email: string
  role: Role
  theme: Theme
  password_hash: string
  created_at: Date
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    theme: row.theme,
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

/** Changes the user's name and/or colour theme; returns the updated row. */
export async function updateUser(id: string, fields: { name?: string; theme?: Theme }) {
  const { rows } = await pool.query<UserRow>(
    `UPDATE users SET name = coalesce($2, name), theme = coalesce($3, theme) WHERE id = $1 RETURNING *`,
    [id, fields.name ?? null, fields.theme ?? null],
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
