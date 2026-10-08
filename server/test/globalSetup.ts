import { readFile } from 'node:fs/promises'
import pg from 'pg'

/** Runs once before the server tests: checks the target and applies the schema. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL
  if (!url) {
    throw new Error(
      'No test database configured. Set TEST_DATABASE_URL, or DATABASE_URL in .env.local.',
    )
  }
  const dbName = new URL(url).pathname.slice(1)
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to run tests against "${dbName}": name must end in _test.`)
  }

  const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8')
  const client = new pg.Client({ connectionString: url })
  try {
    await client.connect()
  } catch (err) {
    throw new Error(
      `Could not connect to test database "${dbName}". Create it with: createdb -U postgres ${dbName}`,
      { cause: err },
    )
  }
  try {
    await client.query(schema)
  } finally {
    await client.end()
  }
}
