/**
 * How the welcome email names the starting file: its label's first sentence,
 * after "the" unless it already starts with an article, e.g. "The complaint
 * and order. Read this first." → "the complaint and order".
 */
export function startingFilePhrase(label: string) {
  const first = label.trim().split(/(?<=[a-z]{3}[.!?])\s+(?=[A-Z])/)[0].replace(/[.!?]+$/, '')
  return /^(the|a|an)\s/i.test(first) ? first.charAt(0).toLowerCase() + first.slice(1) : `the ${first}`
}
