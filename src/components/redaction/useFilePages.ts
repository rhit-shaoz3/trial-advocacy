import { useEffect, useRef, useState } from 'react'
import { loadPdfJs } from './redactFile'

/**
 * A PDF's pages (or a picture, as one page) drawn as pictures to show, and the
 * file's bytes. `load` is read once; null loads nothing.
 */
export function useFilePages(load: (() => Promise<Uint8Array>) | null, pdf: boolean, cantShow: string) {
  // The parent passes a new function each render; load once.
  const loadRef = useRef(load)
  const loading = Boolean(load)
  const [state, setState] = useState<{
    pages: string[] | null
    bytes: Uint8Array | null
    loadError: string | null
  }>({
    pages: null,
    bytes: null,
    loadError: null,
  })
  useEffect(() => {
    const run = loadRef.current
    if (!run) return
    let cancelled = false
    const made: string[] = []
    ;(async () => {
      const data = await run()
      if (!pdf) {
        made.push(URL.createObjectURL(new Blob([data as BlobPart])))
        return { pages: made, bytes: data }
      }
      const pdfjs = await loadPdfJs()
      const task = pdfjs.getDocument({ data: data.slice() })
      const doc = await task.promise
      for (let n = 1; n <= doc.numPages && !cancelled; n++) {
        const page = await doc.getPage(n)
        const base = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({
          scale: Math.min(2, 1400 / base.width),
        })
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(viewport.width)
        canvas.height = Math.round(viewport.height)
        await page.render({
          canvas,
          canvasContext: canvas.getContext('2d')!,
          viewport,
        }).promise
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
        if (blob) made.push(URL.createObjectURL(blob))
      }
      await task.destroy()
      return { pages: made, bytes: data }
    })()
      .then((r) => !cancelled && setState({ ...r, loadError: null }))
      .catch(
        () =>
          !cancelled &&
          setState({
            pages: null,
            bytes: null,
            loadError: cantShow,
          }),
      )
    return () => {
      cancelled = true
      for (const u of made) URL.revokeObjectURL(u)
    }
  }, [loading, pdf, cantShow])
  return state
}
