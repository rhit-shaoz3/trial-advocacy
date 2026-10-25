import { app } from './app.ts'
import { port } from './config.ts'
import { resumeInvestigations } from './investigator/requests.ts'
import { endExpiredInterviews } from './witness/interviews.ts'

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`)
})

resumeInvestigations().catch((err) => console.error('Could not resume investigations:', err))

// Team interviews end an hour after their first question; this catches the
// ones nobody comes back to, so they still reach the instructor for review.
setInterval(() => {
  endExpiredInterviews().catch((err) => console.error('Could not end expired interviews:', err))
}, 60 * 1000)
