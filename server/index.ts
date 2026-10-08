import { app } from './app.ts'
import { port } from './config.ts'

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`)
})
