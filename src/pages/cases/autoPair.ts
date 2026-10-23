/** "2 teams of 3, 1 student left to place" for the auto-pair dialog. */
export function autoPairPreview(students: number, size: number) {
  const teams = Math.floor(students / size)
  const left = students % size
  if (teams === 0) return `Not enough students for a team of ${size}.`
  const made = `${teams} ${teams === 1 ? 'team' : 'teams'} of ${size}`
  return left === 0 ? `${made}, everyone placed.` : `${made}, ${left} ${left === 1 ? 'student' : 'students'} left to place by hand.`
}
