const HONORIFIC = /^(dr|prof|mr|mrs|ms|mx)\.?$/i

/** The words of a name without a leading "Dr.", "Prof." etc. */
function nameWords(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const withoutTitles = words.filter((w) => !HONORIFIC.test(w))
  return withoutTitles.length ? withoutTitles : words
}

/** "Maya Chen" -> "MC", "Dr. Eleanor Brooks" -> "EB", "Cher" -> "CH". */
export function initials(name: string) {
  const words = nameWords(name)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

/** "Dr. Eleanor Brooks" -> "Eleanor"; used in greetings. */
export function firstName(name: string) {
  return nameWords(name)[0] ?? name
}
