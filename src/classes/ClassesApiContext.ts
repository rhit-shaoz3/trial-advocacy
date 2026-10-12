import { createContext, useContext } from 'react'
import { httpClassesApi } from './httpClassesApi'
import type { ClassesApi } from './types'

/** Defaults to the real API; tests wrap the app in a provider with a fake. */
export const ClassesApiContext = createContext<ClassesApi>(httpClassesApi)

export function useClassesApi() {
  return useContext(ClassesApiContext)
}
