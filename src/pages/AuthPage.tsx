import { ArrowRight, CircleCheck, Eye, EyeOff, GraduationCap, Mail, Users } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth/useAuth'
import type { Role } from '../auth/types'
import { Brand } from '../layout/AppShell'
import { ThemeToggle } from '../theme/ThemeToggle'
import './AuthPage.css'

const ROLE_OPTIONS: { role: Role; title: string; desc: string; Icon: typeof Users }[] = [
  { role: 'instructor', title: 'Instructor', desc: 'Manage your classes', Icon: GraduationCap },
  { role: 'student', title: 'Student', desc: 'Prepare your case', Icon: Users },
]

type Mode = 'login' | 'signup'

const MIN_PASSWORD_LENGTH = 8

export function AuthPage() {
  const { logIn, signUp } = useAuth()
  const [mode, setMode] = useState<Mode>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [role, setRole] = useState<Role>('student')
  const [classCode, setClassCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const isSignUp = mode === 'signup'

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
    setPassword('')
    setConfirmPassword('')
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (isSignUp) {
      if (password.length < MIN_PASSWORD_LENGTH) {
        setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
        return
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.')
        return
      }
    }

    setSubmitting(true)
    try {
      if (isSignUp) {
        const code = role === 'student' ? classCode.trim() : ''
        await signUp({ name, email, password, role, ...(code && { classCode: code }) })
      } else {
        await logIn({ email, password })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth">
      <aside className="auth-panel">
        <Brand />
        <div className="auth-panel-body">
          <p className="eyebrow auth-panel-eyebrow">Trial advocacy simulation</p>
          <p className="auth-headline">
            {isSignUp ? 'Great advocates start with great teaching.' : 'The practice behind a confident advocate.'}
          </p>
          <p className="auth-tagline">
            Bring cases, teams, and preparation together in a thoughtful workspace built for
            learning.
          </p>
          <img className="auth-photo" src="/login-photo.jpg" alt="" />
          <div className="auth-caption">
            <span>Real preparation. Meaningful collaboration.</span>
            <span>Built for the classroom</span>
          </div>
        </div>
        <p className="auth-footer">© 2026 Getting to Trial · Learning through practice</p>
      </aside>

      <main className="auth-main">
        <div className="auth-topline">
          <ThemeToggle />
        </div>
        <div className="auth-form-wrap">
          <p className="eyebrow">Welcome to Getting to Trial</p>
          <h1 className="auth-title">{isSignUp ? 'Create your account.' : 'Welcome back.'}</h1>
          <p className="page-lede">
            {isSignUp
              ? 'Instructors set up classes and cases. Students join with a class code.'
              : 'Sign in to your teaching or simulation workspace.'}
          </p>

          <form className="form auth-form" onSubmit={handleSubmit}>
            {isSignUp && (
              <fieldset className="role-cards">
                <legend>I am a…</legend>
                {ROLE_OPTIONS.map(({ role: value, title, desc, Icon }) => (
                  <label key={value} className={role === value ? 'role-card selected' : 'role-card'}>
                    <input
                      type="radio"
                      name="role"
                      value={value}
                      checked={role === value}
                      onChange={() => setRole(value)}
                    />
                    <span className="role-card-top">
                      <Icon size={22} strokeWidth={1.6} aria-hidden />
                      {role === value ? (
                        <CircleCheck size={18} aria-hidden className="role-check" />
                      ) : (
                        <span className="role-dot" aria-hidden />
                      )}
                    </span>
                    <span className="role-title">{title}</span>
                    <span className="role-desc">{desc}</span>
                  </label>
                ))}
              </fieldset>
            )}

            {isSignUp && (
              <label>
                Full name
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  required
                />
              </label>
            )}

            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </label>

            <div className="field">
              <label htmlFor="auth-password">Password</label>
              <div className="password-field">
                <input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  className="input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  required
                />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {isSignUp && (
                <span className="hint field-hint">At least {MIN_PASSWORD_LENGTH} characters.</span>
              )}
            </div>

            {isSignUp && (
              <label>
                Confirm password
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </label>
            )}

            {isSignUp && role === 'student' && (
              <label>
                Class code (optional)
                <input
                  type="text"
                  value={classCode}
                  onChange={(e) => setClassCode(e.target.value)}
                  autoComplete="off"
                  placeholder="e.g. EVID517"
                />
              </label>
            )}

            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}

            <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
              {!submitting && <ArrowRight size={18} aria-hidden />}
              {submitting ? 'Please wait…' : isSignUp ? 'Create account' : 'Sign in'}
            </button>
          </form>

          {!isSignUp && (
            <p className="note auth-note">
              <Mail size={18} aria-hidden />
              <span>
                <strong>Students:</strong> your instructor gives you a class code. Create an
                account and enter it to join your class.
              </span>
            </p>
          )}

          <p className="auth-switch">
            {isSignUp ? 'Already have an account?' : 'New here?'}{' '}
            <button type="button" className="link-button" onClick={() => switchMode(isSignUp ? 'login' : 'signup')}>
              {isSignUp ? 'Sign in' : 'Create an account'} <ArrowRight size={15} aria-hidden />
            </button>
          </p>
        </div>
      </main>
    </div>
  )
}
