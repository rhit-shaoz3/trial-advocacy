import request from 'supertest'
import { app } from '../app.ts'
import { pool } from '../db/pool.ts'

export async function resetDatabase() {
  await pool.query('TRUNCATE users, session, courses, enrollments, cases, teams, team_members, matchups, matchup_teams, case_materials, case_witnesses, case_tasks, task_completions, interviews, interview_reviews CASCADE')
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

/** Every case needs at least one important fact per side. */
export const sampleFacts = {
  plaintiff: ['The lap bar light was red when the ride left the station.'],
  defense: ['The ride passed its safety inspection that morning.'],
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

/**
 * Uploads a case file the way the browser does: ask for an upload link, PUT
 * the file to it (the local storage stand-in), then confirm. Returns the
 * first response that wasn't a success, or the confirmation.
 */
export async function uploadCaseFile(
  agent: request.Agent,
  caseUrl: string,
  filename: string,
  // With no audience, the server's default applies (instructors only).
  { audience, description = '' }: { audience?: string; description?: string } = {},
  data = Buffer.from('%PDF-1.7 test'),
) {
  const start = await agent.post(`${caseUrl}/materials/uploads`).send({ filename, size: data.length })
  if (start.status !== 201) return start
  const { key, url, headers } = start.body.upload
  const put = await agent.put(url).set(headers).send(data)
  if (put.status !== 200) return put
  return agent.post(`${caseUrl}/materials`).send({ uploadKey: key, filename, audience, description })
}
