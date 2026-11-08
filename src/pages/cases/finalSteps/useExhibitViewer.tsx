import { useState } from 'react'
import { FileViewer } from '../../../components/FileViewer'
import { useCourseService } from '../../../courses/CourseServiceContext'
import type { Exhibit, ExhibitVersion } from '../../../courses/types'
import { ExcerptModal } from '../../../caseWorkspace/finalSteps/ExhibitListSection'

type Viewable = Pick<Exhibit, 'id' | 'kind' | 'title' | 'excerpt' | 'contentType' | 'redacted'> & {
  /** The redacted version the offering side proposed (its excerpt, for text, in `excerpt`). */
  version?: ExhibitVersion
}

/**
 * Opens an exhibit for the instructor, as the sides see it: a file (its listed
 * pages, or the redacted copy, or the proposed one) in the viewer, or a
 * transcript, report or redacted text as its text.
 */
export function useExhibitViewer(courseId: string, caseId: string) {
  const service = useCourseService()
  const [open, setOpen] = useState<Viewable | null>(null)
  const element =
    open === null ? null : open.excerpt ? (
      <ExcerptModal
        title={open.title}
        kind={open.kind}
        parts={open.excerpt}
        redacted={open.redacted}
        version={open.version}
        onClose={() => setOpen(null)}
      />
    ) : open.kind === 'material' ? (
      <FileViewer
        file={{
          id: open.version ? `${open.id}:${open.version}` : open.id,
          title: open.version ? `${open.title} · proposed version` : open.title,
          filename: open.title,
          // A redacted picture is stored as a PNG.
          contentType: (open.version || open.redacted) && open.contentType?.startsWith('image/') ? 'image/png' : (open.contentType ?? 'application/pdf'),
        }}
        downloadUrl={service.caseExhibitFileUrl(courseId, caseId, open.id, open.version)}
        loadText={() => service.caseExhibitText(courseId, caseId, open.id)}
        onClose={() => setOpen(null)}
      />
    ) : null
  return { open: setOpen, element }
}
