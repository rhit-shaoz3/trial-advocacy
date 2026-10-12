import { useLocation } from 'react-router'

/** Stand-in for pages a test navigates away to; shows the URL it landed on. */
export function NavigatedTo() {
  return <p>Navigated to {useLocation().pathname}</p>
}
