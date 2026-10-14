import { useCallback } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { useLoad } from '../api/useLoad'
import { useCasesApi } from './CasesApiContext'
import { CharactersSection } from './CharactersSection'
import { DocumentsSection } from './DocumentsSection'
import { TeamsSection } from './TeamsSection'
import type { Section } from './types'
import './Cases.css'

export function InstructorCasePage() {
  const { courseId = '', caseId = '' } = useParams()
  const api = useCasesApi()
  const { data: c, error, reload, setData } = useLoad(
    useCallback(() => api.getInstructorCase(caseId), [api, caseId]),
  )
  // Errors show next to the button that was pressed (see PublishControl).
  const publish = (section: Section) => async (published: boolean) => {
    setData(await api.setPublished(caseId, { [section]: published }))
  }

  return (
    <main className="ws-page case-page">
      <Link to={`/courses/${courseId}/cases`} className="ws-link case-back">
        <ArrowLeft aria-hidden="true" /> All cases
      </Link>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {c && (
        <>
          <div className="ws-welcome">
            <div>
              <span className="ws-eyebrow">Case · {c.courseName}</span>
              <h1 className="ws-title">{c.name}</h1>
              <p className="ws-subtle">
                {c.students.length} students · {c.documents.length} files · {c.characters.length}{' '}
                characters · {c.teams.length} teams
              </p>
            </div>
          </div>
          <div className="case-stack">
            <DocumentsSection c={c} onChanged={reload} onPublish={publish('documents')} />
            <CharactersSection c={c} onChanged={reload} onPublish={publish('characters')} />
            <TeamsSection c={c} onPublish={publish('teams')} />
          </div>
        </>
      )}
    </main>
  )
}
