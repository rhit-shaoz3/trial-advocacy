import { useCallback, useState } from 'react'
import { errorMessage, useLoad } from '../api/useLoad'
import { useCourseService } from '../courses/CourseServiceContext'

/** A student's courses and inbox (invitations, waiting requests, denials). */
export function useStudentHome() {
  const service = useCourseService()
  const { data, error: loadError, reload } = useLoad(
    useCallback(async () => {
      const [courses, inbox] = await Promise.all([service.listMyCourses(), service.getInbox()])
      return { courses, inbox }
    }, [service]),
  )
  const [actionError, setActionError] = useState<string | null>(null)

  /** Runs a notice's button action, then refreshes everything it might affect. */
  async function act(action: () => Promise<void>) {
    setActionError(null)
    try {
      await action()
      await reload()
    } catch (err) {
      setActionError(errorMessage(err))
    }
  }

  return {
    service,
    courses: data?.courses ?? null,
    inbox: data?.inbox ?? null,
    error: actionError ?? loadError,
    reload,
    act,
  }
}
