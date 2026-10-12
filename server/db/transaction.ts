import type { Pool, PoolClient } from 'pg'
import { pool } from './pool.ts'

/** Anything that can run a query: the pool, or a client inside a transaction. */
export type Db = Pick<Pool, 'query'>

/** Runs `fn` in a transaction. If it throws, everything it wrote is undone. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
