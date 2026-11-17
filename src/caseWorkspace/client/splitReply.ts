/** The reply's From, To, Date and Subject lines, and its body without them or its "Attachments:" list. */
export function splitReply(reply: string) {
  const lines = reply.replace(/\r\n/g, '\n').split('\n')
  const headers: Partial<Record<'from' | 'to' | 'date' | 'subject', string>> = {}
  let i = 0
  for (; i < lines.length; i++) {
    const header = /^(From|To|Date|Subject):\s*(.*)$/i.exec(lines[i].trim())
    if (!header) break
    headers[header[1].toLowerCase() as keyof typeof headers] = header[2].trim()
  }
  const rest = lines.slice(i).join('\n')
  // The attachments are listed as files, so their names needn't repeat at the end.
  const body = rest.replace(/\n\s*Attachments:\s*\n[\s\S]*$/i, '').trim()
  return { headers, body }
}
