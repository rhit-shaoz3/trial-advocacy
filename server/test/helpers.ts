import request from 'supertest'
import { app } from '../app.ts'
import { pool } from '../db/pool.ts'

export async function resetDatabase() {
  await pool.query('TRUNCATE users, session, courses, enrollments, cases, teams, team_members, matchups, matchup_teams, case_materials, case_witnesses, case_tasks, task_completions CASCADE')
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

/** Signs up a student the instructor already added to the roster, and accepts the invitation. */
export async function acceptedStudent(courseId: string, email: string, name?: string) {
  const student = await signedInAgent('student', email, name)
  const res = await student.agent.post(`/api/courses/${courseId}/invitation/accept`)
  if (res.status !== 204) throw new Error(`Accept failed: ${JSON.stringify(res.body)}`)
  return student
}

export const fallTrial = { code: 'LAW 540', title: 'Trial Advocacy', season: 'Fall', year: 2026 }

/** The student enters the entry code and the instructor admits them, so they've joined. */
export async function joinCourse(
  student: request.Agent,
  instructor: request.Agent,
  course: { id: string; entryCode: string },
) {
  await student.post('/api/courses/join').send({ entryCode: course.entryCode })
  const me = await student.get('/api/auth/me')
  const res = await instructor
    .post(`/api/courses/${course.id}/roster/requests`)
    .send({ userIds: [me.body.user.id], decision: 'admit' })
  if (res.status !== 200) throw new Error(`Admit failed: ${JSON.stringify(res.body)}`)
}

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
 * the file to it (the local storage stand-in), then confirm. Then publishes
 * it, unless `published` is false. Returns the first response that wasn't a
 * success, or the confirmation (with the published file).
 */
export async function uploadCaseFile(
  agent: request.Agent,
  caseUrl: string,
  filename: string,
  {
    audience = 'all',
    description = '',
    published = true,
  }: { audience?: string; description?: string; published?: boolean } = {},
  data = Buffer.from('%PDF-1.7 test'),
) {
  const start = await agent.post(`${caseUrl}/materials/uploads`).send({ filename, size: data.length })
  if (start.status !== 201) return start
  const { key, url, headers } = start.body.upload
  const put = await agent.put(url).set(headers).send(data)
  if (put.status !== 200) return put
  const created = await agent.post(`${caseUrl}/materials`).send({ uploadKey: key, filename, audience, description })
  if (created.status !== 201 || !published) return created
  const publish = await agent.put(`${caseUrl}/materials/${created.body.material.id}/published`).send({ published: true })
  if (publish.status !== 200) return publish
  created.body.material = publish.body.material
  return created
}

/** Adds a witness to a case and publishes it (unless `published` is false); returns the creation response. */
export async function addWitness(
  agent: request.Agent,
  caseUrl: string,
  fields: Record<string, unknown>,
  published = true,
) {
  const created = await agent.post(`${caseUrl}/witnesses`).send(fields)
  if (created.status !== 201 || !published) return created
  const publish = await agent.put(`${caseUrl}/witnesses/${created.body.witness.id}/published`).send({ published: true })
  if (publish.status !== 200) return publish
  created.body.witness = publish.body.witness
  return created
}
