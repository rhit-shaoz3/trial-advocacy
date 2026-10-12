import { useCallback, useEffect, useState } from 'react'
import { errorMessage } from '../dashboard/errorMessage'

/**
 * Loads data when the component mounts. `load` must be stable (wrap it in
 * useCallback). `reload` fetches again, e.g. after a change.
 */
export function useLoad<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setData(await load())
      setError(null)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [load])

  useEffect(() => {
    void reload()
  }, [reload])

  return { data, error, reload, setData }
}
