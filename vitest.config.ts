import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const TEST_DB_NAME = 'trial_advocacy_test'

/**
 * Server tests wipe their tables, so they get their own database. Use
 * TEST_DATABASE_URL if set (CI), otherwise reuse the credentials in
 * DATABASE_URL from .env.local but point at `trial_advocacy_test`.
 */
function resolveTestDatabaseUrl() {
  const env = { ...loadEnv('test', process.cwd(), ''), ...process.env }
  if (env.TEST_DATABASE_URL) return env.TEST_DATABASE_URL
  if (!env.DATABASE_URL) return undefined
  const url = new URL(env.DATABASE_URL)
  url.pathname = `/${TEST_DB_NAME}`
  return url.toString()
}

const testDatabaseUrl = resolveTestDatabaseUrl()
if (testDatabaseUrl) process.env.TEST_DATABASE_URL = testDatabaseUrl

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'server',
          include: ['server/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['server/test/globalSetup.ts'],
          setupFiles: ['server/test/fakeAi.ts'],
          // Case files go to a temporary folder, never to S3.
          env: {
            DATABASE_URL: testDatabaseUrl ?? '',
            NODE_ENV: 'test',
            // Tests never call Claude; they swap in fakes for `ai`.
            ANTHROPIC_API_KEY: '',
            S3_BUCKET: '',
            STORAGE_DIR: join(tmpdir(), 'trial-advocacy-test-storage'),
          },
          // All server test files share one database.
          fileParallelism: false,
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'web',
          include: ['src/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['src/test/setup.ts'],
        },
      },
    ],
  },
})
