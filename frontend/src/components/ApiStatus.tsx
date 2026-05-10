import { useEffect, useState } from 'react'

interface ApiStatusInfo {
  apiUrl: string
  backend: 'unknown' | 'connected' | 'error'
  errorMessage?: string
  responseTime?: number
}

export function ApiStatus() {
  const [status, setStatus] = useState<ApiStatusInfo>({
    apiUrl: import.meta.env.VITE_API_URL || 'http://localhost:8000/api',
    backend: 'unknown',
  })

  useEffect(() => {
    const checkBackend = async () => {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000/api'
      const healthUrl = apiUrl.replace('/api', '') + '/health'
      
      console.log('🔍 Checking API Status:', { apiUrl, healthUrl })
      
      try {
        const startTime = performance.now()
        const response = await fetch(healthUrl, { 
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          }
        })
        const endTime = performance.now()
        const responseTime = Math.round(endTime - startTime)

        if (response.ok) {
          const data = await response.json()
          console.log('✅ Backend Health Check Passed:', data)
          setStatus({
            apiUrl,
            backend: 'connected',
            responseTime,
          })
        } else {
          console.error('❌ Backend returned status:', response.status)
          setStatus({
            apiUrl,
            backend: 'error',
            errorMessage: `HTTP ${response.status}`,
          })
        }
      } catch (error: any) {
        console.error('❌ Backend Health Check Failed:', {
          error: error.message,
          name: error.name,
          stack: error.stack,
        })
        setStatus({
          apiUrl,
          backend: 'error',
          errorMessage: error.message,
        })
      }
    }

    checkBackend()
    // Check every 5 seconds
    const interval = setInterval(checkBackend, 5000)
    
    return () => clearInterval(interval)
  }, [])

  const bgColor = {
    connected: 'bg-green-50 border-green-200',
    error: 'bg-red-50 border-red-200',
    unknown: 'bg-yellow-50 border-yellow-200',
  }[status.backend]

  const textColor = {
    connected: 'text-green-700',
    error: 'text-red-700',
    unknown: 'text-yellow-700',
  }[status.backend]

  const dotColor = {
    connected: 'bg-green-500',
    error: 'bg-red-500',
    unknown: 'bg-yellow-500',
  }[status.backend]

  return (
    <div className={`p-4 rounded border ${bgColor}`}>
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-3 h-3 rounded-full ${dotColor}`}></div>
        <span className={`font-semibold ${textColor}`}>
          API Status: {status.backend.charAt(0).toUpperCase() + status.backend.slice(1)}
        </span>
      </div>
      
      <div className="text-sm space-y-1">
        <div><strong>API URL:</strong> <code className="bg-white px-2 py-1 rounded">{status.apiUrl}</code></div>
        {status.responseTime && (
          <div><strong>Response Time:</strong> {status.responseTime}ms</div>
        )}
        {status.errorMessage && (
          <div className={textColor}>
            <strong>Error:</strong> {status.errorMessage}
          </div>
        )}
      </div>
      
      {status.backend === 'error' && (
        <div className="mt-3 text-sm bg-white p-3 rounded border border-red-200">
          <p className="font-semibold mb-1">🔧 Troubleshooting:</p>
          <ul className="list-disc list-inside space-y-1 text-red-700">
            <li>Make sure the backend is running: <code>docker-compose ps</code></li>
            <li>Check backend logs: <code>docker logs proptech_backend</code></li>
            <li>Verify API URL is correct: {status.apiUrl}</li>
            <li>Check CORS is enabled on backend (port 8000)</li>
            <li>Check your firewall/network settings</li>
          </ul>
        </div>
      )}
    </div>
  )
}
