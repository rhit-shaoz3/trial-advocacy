/** Calendar date helpers. Days are YYYY-MM-DD strings in the user's local time. */

const pad = (n: number) => String(n).padStart(2, '0')

/** "2026-11-20" for a local date. */
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** The local date for "2026-11-20". */
export function fromDayKey(key: string) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** The month's grid: whole weeks (Sunday first) covering every day of the month. */
export function monthGrid(year: number, month: number) {
  const first = new Date(year, month, 1)
  const start = new Date(year, month, 1 - first.getDay())
  const last = new Date(year, month + 1, 0)
  const days: Date[] = []
  for (let d = start; d <= last || d.getDay() !== 0; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    days.push(d)
  }
  return days
}

/** "November 2026" */
export const monthTitle = (year: number, month: number) =>
  new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

/** "Fri, Nov 20" */
export const dayTitle = (key: string) =>
  fromDayKey(key).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
