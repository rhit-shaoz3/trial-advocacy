// Where the user last was in each section of the sidebar (Cases, Calendar,
// ...), so its link goes back there: a case and its open tab, say, rather than
// the list of cases. Kept for the visit in sessionStorage, per user, so a
// reload keeps it and someone else signing in on the same tab doesn't get it.

const key = (userId: string, section: string) => `lastPlace:${userId}:${section}`

/** The last address (path and query) the user was at in `section`, or null. */
export function lastPlace(userId: string, section: string): string | null {
  try {
    return sessionStorage.getItem(key(userId, section))
  } catch {
    return null
  }
}

export function rememberPlace(userId: string, section: string, place: string) {
  try {
    sessionStorage.setItem(key(userId, section), place)
  } catch {
    // Storage can be blocked; the link then goes to the section's start, as before.
  }
}

/** Whether `pathname` is in the section at `section` (the section's own page, or one below it). */
export const inSection = (pathname: string, section: string) => pathname === section || pathname.startsWith(`${section}/`)

/** A link's path, without its query (`?sample`). */
export const pathOf = (to: string) => to.split('?')[0]
