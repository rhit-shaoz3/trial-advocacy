import { isProduction } from '../config.ts'
import { localStorage, type LocalStorage } from './localStorage.ts'
import { s3Storage } from './s3Storage.ts'
import type { FileStorage } from './shared.ts'

export type { FileStorage } from './shared.ts'

/** The local folder store when not using S3 (development and tests), else null. */
export let localStore: LocalStorage | null = null

function createStorage(): FileStorage {
  const bucket = process.env.S3_BUCKET
  if (bucket) return s3Storage(bucket, process.env.AWS_REGION ?? 'us-east-1')
  if (isProduction) {
    // Heroku's disk is wiped on every restart, so files must go to S3.
    throw new Error('S3_BUCKET must be set in production (see docs/s3-setup.md).')
  }
  localStore = localStorage(process.env.STORAGE_DIR ?? '.storage')
  return localStore
}

/** Where case files are stored: S3 when S3_BUCKET is set, otherwise a local folder. */
export const storage = createStorage()
