import { createContext, useContext } from 'react'
import { httpCasesApi } from './httpCasesApi'
import type { CasesApi } from './types'

/** Defaults to the real API; tests wrap the app in a provider with a fake. */
export const CasesApiContext = createContext<CasesApi>(httpCasesApi)

export function useCasesApi() {
  return useContext(CasesApiContext)
}
