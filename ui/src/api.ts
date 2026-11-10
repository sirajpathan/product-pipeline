const API_BASE_URL = 'http://localhost:3001'
const TOKEN_STORAGE_KEY = 'token'

export async function apiRequest(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers)
  const token = localStorage.getItem(TOKEN_STORAGE_KEY)

  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  })

  const isLoginRequest = path.split('?')[0] === '/auth/login'
  if (response.status === 401 && !isLoginRequest) {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
    if (window.location.pathname !== '/login') {
      window.location.assign('/login')
    }
  }

  return response
}
