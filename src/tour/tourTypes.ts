/** Where a step's card sits beside what it points at; auto picks whichever side has room. */
export type TourPlacement = 'auto' | 'top' | 'bottom' | 'left' | 'right'

export interface TourStep {
  /** A CSS selector for what the step points at; leave out for a card in the middle of the screen. */
  target?: string
  title: string
  body: string
  placement?: TourPlacement
  /** Opens the part of the page the step is about first (a case tab, an exchange section). */
  go?: { tab?: string; section?: string }
  /**
   * When the target isn't on the page (a tab the case doesn't have yet, a
   * section with nothing in it): skip drops the step, center still shows the
   * card, in the middle of the screen.
   */
  ifMissing?: 'skip' | 'center'
}

export interface Tour {
  /** Remembered on the user's account once the tour starts, e.g. student-course. */
  key: string
  /** Shown above each step, e.g. "Case tour". */
  title: string
  steps: TourStep[]
  /** Other keys this tour covers, so their tours don't start on their own too (a case tour covers its phase). */
  alsoMarks?: string[]
}

/** How a page opens the part of itself a step points into. */
export interface TourNavigator {
  selectTab?(tab: string): void
  selectSection?(section: string): void
}
