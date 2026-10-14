import { createContext, useContext } from 'react'

/** Lets the top bar's menu button open the sidebar on small screens. */
export const NavContext = createContext<{ openNav(): void }>({ openNav() {} })

export function useNav() {
  return useContext(NavContext)
}
