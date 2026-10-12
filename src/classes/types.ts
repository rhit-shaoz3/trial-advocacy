// Match the shapes returned by server/classes/classes.ts.

export interface Person {
  id: string
  name: string
  email: string
}

export interface Invitation {
  id: string
  email: string
  /** The student's name, if the email belongs to a student account. */
  name: string | null
  hasAccount: boolean
}

export interface InstructorClass {
  id: string
  name: string
  joinCode: string
  students: Person[]
  invitations: Invitation[]
  pendingRequests: Person[]
}

export interface StudentClass {
  id: string
  name: string
  instructors: string[]
}

export interface CreatedClass {
  class: { id: string; name: string; joinCode: string }
  invited: number
  withAccounts: number
}

export interface ClassRef {
  classId: string
  className: string
}

export interface StudentInbox {
  invitations: { id: string; className: string }[]
  pendingRequests: ClassRef[]
  denials: ClassRef[]
}

export interface JoinResult {
  status: 'requested' | 'enrolled'
  className: string
}

export type Decision = 'admit' | 'deny'

/** Everything the dashboards need from the classes API; tests swap in a fake. */
export interface ClassesApi {
  listInstructorClasses(): Promise<InstructorClass[]>
  createClass(input: { name: string; studentEmails: string[] }): Promise<CreatedClass>
  decideRequests(classId: string, userIds: string[], decision: Decision): Promise<void>

  listStudentClasses(): Promise<StudentClass[]>
  getInbox(): Promise<StudentInbox>
  joinClass(code: string): Promise<JoinResult>
  acceptInvitation(id: string): Promise<void>
  rejectInvitation(id: string): Promise<void>
  dismissDenial(classId: string): Promise<void>
}
