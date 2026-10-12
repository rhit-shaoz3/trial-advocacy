import { useCallback } from 'react'
import { useParams } from 'react-router'
import { useLoad } from '../api/useLoad'
import { PageFrame } from '../layout/PageFrame'
import { useCasesApi } from './CasesApiContext'
import { CharactersSection } from './CharactersSection'
import { DocumentsSection } from './DocumentsSection'
import { TeamsSection } from './TeamsSection'
import type { Section } from './types'
import './Cases.css'

export function InstructorCasePage() {
  const { caseId = '' } = useParams()
  const api = useCasesApi()
  const { data: c, error, reload, setData } = useLoad(
    useCallback(() => api.getInstructorCase(caseId), [api, caseId]),
  )
  // Errors show next to the button that was pressed (see PublishControl).
  const publish = (section: Section) => async (published: boolean) => {
    setData(await api.setPublished(caseId, { [section]: published }))
  }

  return (
    <PageFrame crumbs={[{ label: 'Cases', to: '/cases' }, { label: c?.name ?? 'Case' }]}>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {c && (
        <>
          <div className="page-header">
            <div>
              <p className="eyebrow">Case · {c.className}</p>
              <h1 className="page-title">{c.name}</h1>
              <p className="page-lede">
                {c.students.length} students · {c.documents.length} files · {c.characters.length}{' '}
                characters · {c.teams.length} teams
              </p>
            </div>
          </div>
          <div className="page-stack">
            <DocumentsSection c={c} onChanged={reload} onPublish={publish('documents')} />
            <CharactersSection c={c} onChanged={reload} onPublish={publish('characters')} />
            <TeamsSection c={c} onPublish={publish('teams')} />
          </div>
        </>
      )}
    </PageFrame>
  )
}
