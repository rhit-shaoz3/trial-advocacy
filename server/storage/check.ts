import { randomUUID } from 'node:crypto'
import { storage } from './storage.ts'

/**
 * Checks the storage setup end to end with a throwaway file: a signed upload
 * (as the browser does it), a size check, a move, a signed download, and a
 * delete. Run with `npm run storage:check` after setting the S3 variables.
 * It can't check the bucket's CORS rules; uploading from the app does that.
 */
const where = process.env.S3_BUCKET ? `S3 bucket "${process.env.S3_BUCKET}"` : 'the local storage folder'
console.log(`Checking ${where}…`)

const id = randomUUID()
const uploadKey = `uploads/${id}/${randomUUID()}`
const finalKey = `cases/${id}/${randomUUID()}`
const body = Buffer.from(`storage check ${new Date().toISOString()}\n`)
const type = 'text/plain; charset=utf-8'
const base = process.env.S3_BUCKET ? '' : `http://localhost:${process.env.PORT ?? 3001}`

async function step(name: string, run: () => Promise<void>) {
  try {
    await run()
    console.log(`  ok    ${name}`)
  } catch (err) {
    console.log(`  FAIL  ${name}: ${err instanceof Error ? err.message : err}`)
    process.exitCode = 1
  }
}

await step('signed upload', async () => {
  const { url, headers } = await storage.uploadTarget(uploadKey, type, body.length)
  // Locally the "signed URL" is served by the API, which must be running.
  const res = await fetch(base + url, { method: 'PUT', headers, body })
  if (!res.ok) throw new Error(`PUT returned ${res.status}: ${await res.text()}`)
})
await step('size', async () => {
  const size = await storage.size(uploadKey)
  if (size !== body.length) throw new Error(`expected ${body.length} bytes, got ${size}`)
})
await step('move', () => storage.move(uploadKey, finalKey))
await step('signed download', async () => {
  const res = await fetch(base + (await storage.downloadUrl(finalKey, 'check.txt', type)))
  if (!res.ok) throw new Error(`GET returned ${res.status}`)
  if (!(res.headers.get('content-disposition') ?? '').startsWith('attachment')) {
    throw new Error('the download is not served as an attachment')
  }
  if (!(await res.text()).startsWith('storage check')) throw new Error('downloaded different contents')
})
await step('delete', async () => {
  await storage.delete([uploadKey, finalKey])
  if ((await storage.size(finalKey)) !== null) throw new Error('the file is still there')
})

console.log(process.exitCode ? 'Storage check failed.' : 'Storage is set up correctly.')
