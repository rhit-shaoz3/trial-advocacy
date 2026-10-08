export const isProduction = process.env.NODE_ENV === 'production'

export const port = Number(process.env.PORT ?? 3001)
