import { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { Button, Input, Alert } from '../components/shared/ui';

// ── Login ─────────────────────────────────────────────────────
export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login, isLoading } = useAuthStore();
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await login(email, password);
      navigate('/');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logoRow}>
          <div style={styles.logo}>QF</div>
          <h1 style={styles.logoText}>QAForge</h1>
        </div>
        <h2 style={styles.heading}>Sign in to your account</h2>

        {error && <div style={{ marginBottom: 16 }}><Alert type="error">{error}</Alert></div>}

        <form onSubmit={handleSubmit}>
          <Input
            label="Email address"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoFocus
            required
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            required
          />
          <Button
            type="submit"
            variant="primary"
            full
            size="lg"
            loading={isLoading}
            style={{ marginTop: 4 }}
          >
            Sign in
          </Button>
        </form>

        <p style={styles.footer}>
          Don't have an account?{' '}
          <Link to="/register" style={styles.link}>Create one</Link>
        </p>

      </div>
    </div>
  );
}

// ── Register ──────────────────────────────────────────────────
export function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { register, isLoading } = useAuthStore();
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    try {
      await register(email, password, name);
      navigate('/');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logoRow}>
          <div style={styles.logo}>QF</div>
          <h1 style={styles.logoText}>QAForge</h1>
        </div>
        <h2 style={styles.heading}>Create your account</h2>

        {error && <div style={{ marginBottom: 16 }}><Alert type="error">{error}</Alert></div>}

        <form onSubmit={handleSubmit}>
          <Input
            label="Full name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Ama Kusi"
            autoFocus
            required
          />
          <Input
            label="Email address"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Min. 8 characters"
            hint="At least 8 characters"
            required
          />
          <Button
            type="submit"
            variant="primary"
            full
            size="lg"
            loading={isLoading}
            style={{ marginTop: 4 }}
          >
            Create account
          </Button>
        </form>

        <p style={styles.footer}>
          Already have an account?{' '}
          <Link to="/login" style={styles.link}>Sign in</Link>
        </p>
      </div>
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────
const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--gray-50)',
    padding: 20,
  } as React.CSSProperties,

  card: {
    background: 'var(--surface-base)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--border-radius-lg)',
    boxShadow: 'var(--shadow-md)',
    padding: '40px 40px 32px',
    width: '100%',
    maxWidth: 420,
  } as React.CSSProperties,

  logoRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 24,
    justifyContent: 'center',
  } as React.CSSProperties,

  logo: {
    width: 36,
    height: 36,
    background: 'var(--color-primary)',
    color: '#fff',
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: '0.875rem',
    letterSpacing: '0.05em',
  } as React.CSSProperties,

  logoText: {
    fontSize: '1.25rem',
    fontWeight: 700,
    color: 'var(--gray-900)',
  } as React.CSSProperties,

  heading: {
    fontSize: '1.125rem',
    fontWeight: 600,
    color: 'var(--gray-800)',
    marginBottom: 24,
    textAlign: 'center',
  } as React.CSSProperties,

  footer: {
    textAlign: 'center',
    fontSize: '0.875rem',
    color: 'var(--gray-500)',
    marginTop: 20,
  } as React.CSSProperties,

  link: { color: 'var(--color-primary)', fontWeight: 500 },

  demoBox: {
    marginTop: 20,
    padding: '12px 14px',
    background: 'var(--gray-50)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--border-radius-md)',
  } as React.CSSProperties,

  demoTitle: {
    fontSize: '0.75rem',
    fontWeight: 600,
    color: 'var(--gray-500)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: 8,
  },

  demoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '0.8125rem',
    color: 'var(--gray-600)',
    padding: '2px 0',
  } as React.CSSProperties,
};
