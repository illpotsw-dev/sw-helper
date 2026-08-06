import { useEffect, useState } from 'react'
import { query } from './db/client'

function App() {
  const [dbStatus, setDbStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    query('SELECT 1')
      .then(() => setDbStatus('ready'))
      .catch((err: unknown) => {
        setDbStatus('error')
        setError(err instanceof Error ? err.message : String(err))
      })
  }, [])

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <header className="border-b border-gray-200 px-6 py-4">
        <h1 className="text-xl font-semibold">SW Helper</h1>
      </header>
      <main className="p-6">
        <p className="text-gray-500">
          Database:{' '}
          {dbStatus === 'loading' && 'connecting…'}
          {dbStatus === 'ready' && 'ready'}
          {dbStatus === 'error' && `error — ${error}`}
        </p>
      </main>
    </div>
  )
}

export default App
