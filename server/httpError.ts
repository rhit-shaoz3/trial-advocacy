/** Thrown from route handlers; the error handler turns it into `{ error }` JSON. */
export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
