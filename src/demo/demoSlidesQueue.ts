// Logging in as the demo account opens its slides (DemoSlides) once, in this tab.

const SEEN_KEY = 'demo-slides'

/** Shows the slides the next time a demo page opens (on logging in). */
export function queueDemoSlides() {
  try {
    sessionStorage.setItem(SEEN_KEY, 'show')
  } catch {
    // The slides can still be opened from the demo bar.
  }
}

/** Whether logging in asked for the slides. */
export function demoSlidesQueued() {
  try {
    return sessionStorage.getItem(SEEN_KEY) === 'show'
  } catch {
    return false
  }
}

/** The slides were closed. */
export function clearDemoSlides() {
  try {
    sessionStorage.removeItem(SEEN_KEY)
  } catch {
    // Nothing to clear.
  }
}
