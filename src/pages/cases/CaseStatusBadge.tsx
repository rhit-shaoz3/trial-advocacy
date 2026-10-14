import type { CourseCaseStatus } from '../../courses/types'
import { STATUS_LABEL } from './caseStatus'

export function CaseStatusBadge({ status }: { status: CourseCaseStatus }) {
  return <span className={`badge badge-case-${status}`}>{STATUS_LABEL[status]}</span>
}
