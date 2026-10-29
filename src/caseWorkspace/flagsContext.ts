import { createContext } from 'react'
import type { FlagInput, TeamFlag } from '../courses/types'

// In review lite the AI's calls stand without the instructor, so the team can
// flag one it thinks is wrong (or appeal a denied subpoena). The student's
// case page provides the team's flags; without them (the instructor's
// preview) nothing can be flagged.

export interface FlagsContextValue {
  flags: TeamFlag[]
  raise(input: FlagInput): Promise<void>
  /** Marks the instructor's answers read, once one has been shown. */
  markSeen(): void
}

export const FlagsContext = createContext<FlagsContextValue | null>(null)
