/** A case file shown to the witness with a question. */
export type Exhibit = { id: string; title: string }

/** The most documents one question can show (matches MAX_EXHIBITS on the server). */
export const MAX_EXHIBITS = 3

/** The question as the server stores it: a marker for each document shown, then the question. */
export const withExhibits = (text: string, shown: Exhibit[]) => [...shown.map((e) => `[Exhibit: "${e.title}"]`), text].join(' ')

const EXHIBIT_MARKER = /^\[Exhibit: "([^"]*)"\]\s*/

/** A stored question's documents (by title) and what was asked. */
export function splitExhibits(text: string) {
  const titles: string[] = []
  let rest = text
  for (let m = rest.match(EXHIBIT_MARKER); m; m = rest.match(EXHIBIT_MARKER)) {
    titles.push(m[1])
    rest = rest.slice(m[0].length)
  }
  return { titles, rest }
}

/** 47:12 */
export function clock(ms: number) {
  const seconds = Math.ceil(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
