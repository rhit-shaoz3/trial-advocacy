import { FileAudio, FileText, FileVideo, Image } from 'lucide-react'
import type { FileCategory } from '../courses/caseLabels'

/** The icon for each kind of case file. */
export const CATEGORY_ICON: Record<FileCategory, typeof FileText> = {
  document: FileText,
  image: Image,
  audio: FileAudio,
  video: FileVideo,
}
