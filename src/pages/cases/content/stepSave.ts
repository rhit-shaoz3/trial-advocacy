import type { CourseCase } from '../../../courses/types'

/**
 * What a section hands the case setup flow, so its Next can save the step's
 * unsaved work (files waiting to upload, an edited form) before moving on.
 */
export interface StepSave {
  /** Saves the pending work; throws, with a message to show, if it can't. Resolves with the case when it changed. */
  save(): Promise<CourseCase | void>
  /** Whether there's work that moving on without saving would lose. */
  pending(): boolean
}
