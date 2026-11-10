import { useState, type FormEvent } from 'react'
import { apiRequest } from './api'
import Button from './component/Button'
import InputField from './component/InputField'
import './LoginPage.css'

function isLoginResponse(value: unknown): value is { token: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'token' in value &&
    typeof value.token === 'string' &&
    value.token.length > 0
  )
}

function LoginPage() {
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return

    const formData = new FormData(event.currentTarget)
    const email = formData.get('email')
    const password = formData.get('password')
    if (typeof email !== 'string' || typeof password !== 'string') return

    setIsSubmitting(true)
    setError('')

    try {
      const response = await apiRequest('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      if (!response.ok) {
        const message = (await response.text()).trim()
        throw new Error(message || `Login failed with status ${response.status}.`)
      }

      let responseData: unknown
      try {
        responseData = await response.json()
      } catch {
        throw new Error('The login API returned an invalid JSON response.')
      }

      if (!isLoginResponse(responseData)) {
        throw new Error('The login API response did not include a valid token.')
      }

      localStorage.setItem('token', responseData.token)
      window.location.assign('/')
    } catch (loginError) {
      setError(
        loginError instanceof Error
          ? loginError.message
          : 'An unexpected error occurred while signing in.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">

        <div className="login-form-panel">
          <div className="login-form-content">
            <div className="login-mobile-brand" aria-hidden="true">
              <span className="login-brand-mark">
                <span />
                <span />
                <span />
                <span />
              </span>
              <span>Siraj</span>
            </div>

            <span className="login-eyebrow login-form-eyebrow">WELCOME BACK</span>
            <h1 id="login-title">Sign in to your account</h1>
            <p className="login-intro">Pick up right where you left off.</p>

            <form className="login-form" onSubmit={handleSubmit}>
              <label htmlFor="login-email">Email address</label>
              <InputField
                autoComplete="email"
                id="login-email"
                name="email"
                placeholder="you@example.com"
                required
                type="email"
              />

              <div className="login-password-label">
                <label htmlFor="login-password">Password</label>
                <span className="login-text-link">Forgot password?</span>
              </div>
              <div className="login-password-input">
                <InputField
                  autoComplete="current-password"
                  id="login-password"
                  name="password"
                  placeholder="Enter your password"
                  required
                  type={passwordVisible ? 'text' : 'password'}
                />
                <Button
                  aria-label={passwordVisible ? 'Hide password' : 'Show password'}
                  aria-pressed={passwordVisible}
                  className="login-visibility-button"
                  onClick={() => setPasswordVisible((visible) => !visible)}
                  type="button"
                >
                  {passwordVisible ? 'Hide' : 'Show'}
                </Button>
              </div>

              <label className="login-remember-option" htmlFor="login-remember">
                <InputField id="login-remember" name="remember" type="checkbox" />
                <span>Keep me signed in</span>
              </label>

              {error && (
                <p className="login-error" role="alert">
                  {error}
                </p>
              )}

              <Button
                className="login-submit-button"
                disabled={isSubmitting}
                type="submit"
              >
                {isSubmitting ? (
                  'Signing in…'
                ) : (
                  <>
                    Continue to upload <span aria-hidden="true">→</span>
                  </>
                )}
              </Button>
            </form>

            <p className="login-demo-note">
              Your session token is stored in this browser.
            </p>
          </div>
        </div>
      </section>
    </main>
  )
}

export default LoginPage
