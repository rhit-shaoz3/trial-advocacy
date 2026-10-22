/** How long the rocket takes to lift off before the case page moves on to its phases. */
export const LIFTOFF_MS = 1800
/** With reduced motion: a short pause on the message instead. */
export const CALM_LIFTOFF_MS = 900

export const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
