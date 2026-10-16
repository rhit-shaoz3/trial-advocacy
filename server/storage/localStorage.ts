import { createHmac, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  attachmentHeader,
  DOWNLOAD_URL_TTL_SECONDS,
  KEY_PATTERN,
  UPLOAD_URL_TTL_SECONDS,
  type FileStorage,
} from './shared.ts'

/**
 * A stand-in for S3 when developing locally and in tests: files live under
 * `dir`, and "signed URLs" point at this API with an
 * HMAC signature (served by localStorageRoutes.ts), so the upload and download
 * flow is the same as with S3.
 */
export interface LocalStorage extends FileStorage {
  /** Checks a signed URL's query; returns its parameters, or null if forged or expired. */
  verify(query: Record<string, unknown>): Record<string, string> | null
  write(key: string, data: Buffer): Promise<void>
}

export function localStorage(dir: string): LocalStorage {
  const root = resolve(dir)
  const secret = process.env.SESSION_SECRET || 'dev-only-insecure-secret'

  function pathFor(key: string) {
    if (!KEY_PATTERN.test(key)) throw new Error(`Invalid storage key: ${key}`)
    return join(root, ...key.split('/'))
  }

  const sign = (params: Record<string, string>) =>
    createHmac('sha256', secret)
      .update(Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&'))
      .digest('base64url')

  function signedUrl(params: Record<string, string>, ttlSeconds: number) {
    const withExpiry = { ...params, exp: String(Math.floor(Date.now() / 1000) + ttlSeconds) }
    const query = new URLSearchParams({ ...withExpiry, sig: sign(withExpiry) })
    return `/api/storage/local?${query}`
  }

  return {
    verify(query) {
      const params: Record<string, string> = {}
      for (const [k, v] of Object.entries(query)) if (typeof v === 'string' && k !== 'sig') params[k] = v
      const given = Buffer.from(typeof query.sig === 'string' ? query.sig : '')
      const expected = Buffer.from(sign(params))
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
      if (Number(params.exp) < Date.now() / 1000) return null
      return params
    },

    read: (key) => readFile(pathFor(key)),

    async write(key, data) {
      const path = pathFor(key)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, data)
    },

    async uploadTarget(key, contentType, size) {
      pathFor(key) // validates the key
      const url = signedUrl({ op: 'put', key, type: contentType, size: String(size) }, UPLOAD_URL_TTL_SECONDS)
      return { url, headers: { 'Content-Type': contentType } }
    },

    async size(key) {
      try {
        return (await stat(pathFor(key))).size
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw err
      }
    },

    async move(from, to) {
      const target = pathFor(to)
      await mkdir(dirname(target), { recursive: true })
      await rename(pathFor(from), target)
    },

    async downloadUrl(key, filename, contentType) {
      pathFor(key)
      return signedUrl({ op: 'get', key, type: contentType, disposition: attachmentHeader(filename) }, DOWNLOAD_URL_TTL_SECONDS)
    },

    async put(key, data) {
      await this.write(key, data)
    },

    async delete(keys) {
      await Promise.all(keys.map((key) => rm(pathFor(key), { force: true })))
    },
  }
}
