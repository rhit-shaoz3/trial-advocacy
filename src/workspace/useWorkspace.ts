import { useOutletContext } from 'react-router'
import type { CourseHome } from './types'

export interface WorkspaceContext {
  home: CourseHome
  /** Appended to in-workspace links so `?sample` survives navigation. */
  search: string
}

/** The course data loaded by the surrounding WorkspaceLayout. */
export function useWorkspace() {
  return useOutletContext<WorkspaceContext>()
}
