import { ArrowRight, CircleCheck, Eye, EyeOff, Gavel, GraduationCap, Mail, MessagesSquare, Users } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth/useAuth'
import type { Role } from '../auth/types'
import { ThemeToggle } from '../theme/ThemeToggle'
import './AuthPage.css'

type Mode = 'login' | 'signup'

const MIN_PASSWORD_LENGTH = 8

const ROLE_OPTIONS: { role: Role; title: string; desc: string; Icon: typeof Users }[] = [
  { role: 'student', title: 'Student', desc: 'Investigate, interview, depose', Icon: Users },
  { role: 'instructor', title: 'Instructor', desc: 'Run and monitor case worlds', Icon: GraduationCap },
]

const HIGHLIGHTS = [
  { Icon: MessagesSquare, tone: 'blue', text: 'Interview AI witnesses who answer like real ones' },
  { Icon: Users, tone: 'green', text: 'Prepare with your team, against another' },
  { Icon: Gavel, tone: 'amber', text: 'Instructors rule on every new fact' },
] as const

export function AuthPage() {
  const { logIn, signUp } = useAuth()
  const [mode, setMode] = useState<Mode>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [role, setRole] = useState<Role>('student')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

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
        await signUp({ name, email, password, role })
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
        <div className="auth-brand">
          <img className="auth-brand-icon" src="/favicon.svg" alt="" />
          <span>
            <strong>Getting to Trial</strong>
            <small>Pre-trial litigation simulator</small>
          </span>
        </div>

        <div className="auth-panel-body">
          <p className="auth-eyebrow">Trial advocacy simulation</p>
          <p className="auth-headline">
            {isSignUp ? 'Great advocates start with great practice.' : 'The practice behind a confident advocate.'}
          </p>
          <p className="auth-tagline">
            Investigate a case, depose its witnesses and build your theory with your team, in a workspace built for
            the classroom.
          </p>
          <figure className="auth-figure">
            <img className="auth-photo" src="/login-photo.jpg" alt="" />
            <ul className="auth-highlights">
              {HIGHLIGHTS.map(({ Icon, tone, text }) => (
                <li key={text}>
                  <span className={`auth-highlight-icon auth-tone-${tone}`}>
                    <Icon aria-hidden="true" />
                  </span>
                  {text}
                </li>
              ))}
            </ul>
          </figure>
        </div>

        <p className="auth-footer">© 2026 Getting to Trial · Learning through practice</p>
      </aside>

      <main className="auth-main">
        <div className="auth-topline">
          <ThemeToggle />
        </div>

        <div className="auth-form-wrap">
          <p className="auth-eyebrow">Welcome to Getting to Trial</p>
          <h1 className="auth-title">{isSignUp ? 'Create your account.' : 'Welcome back.'}</h1>
          <p className="auth-subtitle">
            {isSignUp
              ? 'Instructors set up courses and cases. Students join the courses they’re added to.'
              : 'Log in to your course workspace.'}
          </p>

          <div className="auth-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={!isSignUp}
              className={!isSignUp ? 'active' : ''}
              onClick={() => switchMode('login')}
            >
              Log in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isSignUp}
              className={isSignUp ? 'active' : ''}
              onClick={() => switchMode('signup')}
            >
              Sign up
            </button>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            {isSignUp && (
              <fieldset className="auth-roles">
                <legend>I am a…</legend>
                {ROLE_OPTIONS.map(({ role: value, title, desc, Icon }) => (
                  <label key={value} className={role === value ? 'selected' : ''}>
                    <input
                      type="radio"
                      name="role"
                      value={value}
                      checked={role === value}
                      onChange={() => setRole(value)}
                    />
                    <span className="role-top">
                      <Icon aria-hidden="true" />
                      {role === value ? (
                        <CircleCheck aria-hidden="true" className="role-check" />
                      ) : (
                        <span className="role-dot" aria-hidden="true" />
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

            <div className="auth-field">
              <label htmlFor="auth-password">Password</label>
              <div className="auth-password">
                <input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  required
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                </button>
              </div>
              {isSignUp && <span className="auth-hint">At least {MIN_PASSWORD_LENGTH} characters.</span>}
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

            {error && (
              <p className="auth-error" role="alert">
                {error}
              </p>
            )}

            <button type="submit" className="auth-submit" disabled={submitting}>
              {submitting ? 'Please wait…' : isSignUp ? 'Create account' : 'Log in'}
              {!submitting && <ArrowRight aria-hidden="true" />}
            </button>
          </form>

          {!isSignUp && (
            <p className="auth-note">
              <Mail aria-hidden="true" />
              <span>
                <strong>Students:</strong> sign up with the email your instructor added to the course and it’s waiting
                for you, or join later with the course’s entry code.
              </span>
            </p>
          )}

          <p className="auth-switch">
            {isSignUp ? 'Already have an account?' : 'New here?'}{' '}
            <button type="button" onClick={() => switchMode(isSignUp ? 'login' : 'signup')}>
              {isSignUp ? 'Log in' : 'Create an account'}
              <ArrowRight aria-hidden="true" />
            </button>
          </p>
        </div>
      </main>
    </div>
  )
}
