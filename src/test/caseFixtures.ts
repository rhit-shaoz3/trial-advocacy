import type { InstructorCase } from '../cases/types'

export const students = ['Ana', 'Bo', 'Cy', 'Di', 'Ed'].map((name, i) => ({
  id: `s${i + 1}`,
  name,
  email: `${name.toLowerCase()}@school.edu`,
}))

/** A case with five students and nothing else yet; spread in what a test needs. */
export function makeCase(overrides: Partial<InstructorCase> = {}): InstructorCase {
  return {
    id: 'case-1',
    name: 'Smith v. Jones',
    classId: 'class-1',
    className: 'Evidence',
    published: { documents: false, characters: false, teams: false },
    students,
    documents: [],
    characters: [],
    teams: [],
    matchups: [],
    ...overrides,
  }
}
