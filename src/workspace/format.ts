// Date and name helpers for the course workspace. `now` is a parameter so
// tests (and the sample data) can pin the clock.

const DAY_MS = 86_400_000

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Whole calendar days from `now` to `date` (0 = today, 1 = tomorrow, -1 = yesterday). */
export function calendarDaysUntil(date: Date, now: Date) {
  return Math.round((startOfDay(date).getTime() - startOfDay(now).getTime()) / DAY_MS)
}

export function greeting(now: Date) {
  const hour = now.getHours()
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
}

/** "Saturday, October 10" */
export function longDate(now: Date) {
  return now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

/** "today", "tomorrow", "in 3 days" */
export function inDays(days: number) {
  return days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`
}

/** "Just now", "42 minutes ago", "2 hours ago", "Yesterday", "Oct 3" */
export function timeAgo(iso: string, now: Date) {
  const then = new Date(iso)
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const days = calendarDaysUntil(now, then)
  if (days === 0) {
    const hours = Math.floor(minutes / 60)
    return `${hours} hour${hours === 1 ? '' : 's'} ago`
  }
  if (days === 1) return 'Yesterday'
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** "11:59 PM" */
export function clockTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** "OCT" */
export function shortMonth(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short' }).toUpperCase()
}

/** "Alex Morgan" → "AM"; "Cher" → "C" */
export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters = words.length > 1 ? [words[0], words.at(-1)!] : words
  return letters.map((w) => w[0]!.toUpperCase()).join('')
}

/** "Anderson v. Caldwell" → "AC": one letter per party. */
export function caseInitials(title: string) {
  const parties = title.split(/\s+v\.?\s+/i)
  if (parties.length === 2) return (parties[0].trim()[0] + parties[1].trim()[0]).toUpperCase()
  return initials(title)
}

const AVATAR_TONES = ['blue', 'sand', 'green', 'rose'] as const

/** A stable color for a person, so they look the same everywhere. */
export function avatarTone(name: string) {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length]
}
