import { useCallback, useState } from 'react'
import { useLoad } from '../api/useLoad'
import { useClassesApi } from '../classes/ClassesApiContext'
import { errorMessage } from './errorMessage'

/** A student's classes and inbox (invitations, pending requests, denials). */
export function useStudentHome() {
  const api = useClassesApi()
  const { data, error: loadError, reload } = useLoad(
    useCallback(async () => {
      const [classes, inbox] = await Promise.all([api.listStudentClasses(), api.getInbox()])
      return { classes, inbox }
    }, [api]),
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
    api,
    classes: data?.classes ?? null,
    inbox: data?.inbox ?? null,
    error: actionError ?? loadError,
    reload,
    act,
  }
}
