export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Anything email-shaped inside a longer piece of text, e.g. a CSV row.
const EMAIL_IN_TEXT = /[^\s@,;:<>"'()[\]]+@[^\s@,;:<>"'()[\]]+\.[^\s@,;:<>"'()[\]]+/g

/** Every distinct email address in `text`, lowercased, in the order found. */
export function findEmails(text: string) {
  const found = (text.match(EMAIL_IN_TEXT) ?? []).map((e) => e.toLowerCase())
  return [...new Set(found)]
}

/**
 * Pulls email addresses out of an uploaded spreadsheet. Every cell is checked,
 * so it works whatever column the emails are in and whatever the headers say.
 */
export async function readEmailsFromFile(file: File) {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    return findEmails(await file.text())
  }
  if (name.endsWith('.xlsx')) {
    // Loaded on demand so the spreadsheet reader isn't in the main bundle.
    const { default: readExcelFile } = await import('read-excel-file/browser')
    const sheets = await readExcelFile(file)
    const cells = sheets.flatMap((sheet) => sheet.data.flat())
    return findEmails(cells.filter((cell) => typeof cell === 'string').join('\n'))
  }
  throw new Error('Upload an Excel (.xlsx) or CSV file.')
}
