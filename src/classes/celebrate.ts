import confetti from 'canvas-confetti'

/** A short burst of confetti. Skipped if the user has asked for reduced motion. */
export function celebrate() {
  void confetti({
    particleCount: 90,
    spread: 70,
    origin: { y: 0.6 },
    disableForReducedMotion: true,
  })
}
