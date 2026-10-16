import type { CourseCaseStatus } from '../../courses/types'

export const STATUS_LABEL: Record<CourseCaseStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  closed: 'Closed',
}

export const STATUS_HINT: Record<CourseCaseStatus, string> = {
  draft: 'Drafts are hidden from students while you set up teams.',
  active: 'Active: the case worlds are running and students can see their case.',
  closed: 'Closed: the case is finished. Its teams are kept for pairing history.',
}
