import request from 'supertest'
import { app } from '../app.ts'
import { pool } from '../db/pool.ts'

export async function resetDatabase() {
  await pool.query('TRUNCATE users, session, courses, enrollments, fact_patterns CASCADE')
}

/** Signs up a new account and returns an agent that stays logged in as it. */
export async function signedInAgent(
  role: 'student' | 'instructor' = 'student',
  email = `${role}@example.com`,
  name = `Test ${role}`,
) {
  const agent = request.agent(app)
  const res = await agent.post('/api/auth/signup').send({ name, email, password: 'correct-horse', role })
  if (res.status !== 201) throw new Error(`Sign-up failed: ${JSON.stringify(res.body)}`)
  return { agent, userId: res.body.user.id as string }
}

export const fallTrial = { code: 'LAW 540', title: 'Trial Advocacy', season: 'Fall', year: 2026 }

/** Creates a course through the API as `instructor` and returns it. */
export async function createCourseAs(
  instructor: request.Agent,
  input: Record<string, unknown> = fallTrial,
) {
  const res = await instructor.post('/api/courses').send(input)
  if (res.status !== 201) throw new Error(`Create course failed: ${JSON.stringify(res.body)}`)
  return res.body.course as { id: string; entryCode: string }
}
