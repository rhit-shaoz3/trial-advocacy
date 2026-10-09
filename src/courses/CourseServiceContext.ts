import { createContext, useContext } from 'react'
import { httpCourseService } from './httpCourseService'
import type { CourseService } from './types'

/** Defaults to the real API; tests wrap the app in a provider with a fake. */
export const CourseServiceContext = createContext<CourseService>(httpCourseService)

export function useCourseService() {
  return useContext(CourseServiceContext)
}
