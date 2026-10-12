export function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : 'Something went wrong.'
}
