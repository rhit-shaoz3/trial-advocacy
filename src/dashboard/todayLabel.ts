/** e.g. "Monday, October 12" for the greeting on the overview pages. */
export function todayLabel() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}
