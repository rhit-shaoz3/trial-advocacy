import { Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import { useLoad } from '../api/useLoad'
import { useClassesApi } from '../classes/ClassesApiContext'
import { PageFrame } from '../layout/PageFrame'
import { ClassCard } from './ClassCard'
import { CreateClassForm } from './CreateClassForm'
import './Dashboard.css'

export function ClassesPage() {
  const api = useClassesApi()
  const { data: classes, error, reload } = useLoad(
    useCallback(() => api.listInstructorClasses(), [api]),
  )
  const [params] = useSearchParams()
  const [creating, setCreating] = useState(params.get('new') === '1')
  const { hash } = useLocation()

  // "Open class" on the overview links here with #class-<id>; scroll once it has loaded.
  useEffect(() => {
    if (classes && hash) document.getElementById(hash.slice(1))?.scrollIntoView?.({ block: 'start' })
  }, [classes, hash])

  return (
    <PageFrame crumbs={[{ label: 'Instructor workspace', to: '/' }, { label: 'Classes' }]}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Your classes</h1>
          <p className="page-lede">Create classes, share join codes, and decide who gets in.</p>
        </div>
        {!creating && (
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <Plus size={18} aria-hidden /> Create class
          </button>
        )}
      </div>

      <div className="page-stack">
        {creating && <CreateClassForm onCreated={reload} onClose={() => setCreating(false)} />}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        {classes?.length === 0 && !creating && (
          <p className="hint">You haven't created any classes yet.</p>
        )}

        {classes?.map((cls) => <ClassCard key={cls.id} cls={cls} onChanged={reload} />)}
      </div>
    </PageFrame>
  )
}
