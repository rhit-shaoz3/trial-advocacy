import { useOutletContext } from 'react-router'
import type { CourseHome } from './types'

export interface WorkspaceContext {
  home: CourseHome
  /** Appended to in-workspace links so `?sample` survives navigation. */
  search: string
  /** Re-fetches the course home in place, e.g. after the instructor renames the course. */
  reloadHome(): void
}

/** The course data loaded by the surrounding WorkspaceLayout. */
export function useWorkspace() {
  return useOutletContext<WorkspaceContext>()
}
