import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuthStore } from '../store/auth';
import { Button, Input, Alert, Spinner } from '../components/shared/ui';

interface InviteInfo {
  email: string;
  role: string;
  projectName: string;
}

export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const token = params.get('token') ?? '';

  const [info, setInfo]           = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading]     = useState(true);

  const [name, setName]       = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError]     = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoadError('No invite token found in the URL.');
      setLoading(false);
      return;
    }
    api.get<InviteInfo>(`auth/invite/${token}`)
      .then(data => { setInfo(data); setLoading(false); })
      .catch(() => { setLoadError('Invite not found or has expired.'); setLoading(false); });
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim())          { setError('Name is required'); return; }
    if (password.length < 8)   { setError('Password must be at least 8 characters'); return; }
    if (password !== confirm)  { setError('Passwords do not match'); return; }

    setSubmitting(true);
    setError('');
    try {
      const res = await api.post<{ token: string; user: { id: string; email: string; name: string } }>(
        'auth/accept-invite',
        { token, name, password },
      );
      localStorage.setItem('qaforge_token', res.token);
      localStorage.setItem('qaforge_user', JSON.stringify(res.user));
      useAuthStore.getState().hydrate();
      navigate('/');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to accept invite');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div style={{ maxWidth: 400, textAlign: 'center', padding: 24 }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 16 }}>🔗</div>
          <h2 style={{ margin: '0 0 8px' }}>Invite invalid</h2>
          <p style={{ color: 'var(--gray-500)', marginBottom: 24 }}>{loadError}</p>
          <Button variant="primary" onClick={() => navigate('/login')}>Go to login</Button>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--surface-muted)', padding: 20,
    }}>
      <div style={{
        width: '100%', maxWidth: 420,
        background: 'var(--surface-base)', border: '1px solid var(--border-color)',
        borderRadius: 'var(--border-radius-lg)', padding: '32px 36px',
      }}>
        <div style={{ marginBottom: 24, textAlign: 'center' }}>
          <div style={{ fontSize: '1.75rem', marginBottom: 10 }}>👋</div>
          <h2 style={{ margin: '0 0 6px', fontSize: '1.25rem' }}>You're invited!</h2>
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--gray-600)' }}>
            Join <strong>{info?.projectName}</strong> as <strong>{info?.role}</strong>
          </p>
          <p style={{ margin: '4px 0 0', fontSize: '0.8125rem', color: 'var(--gray-400)' }}>
            {info?.email}
          </p>
        </div>

        {error && <div style={{ marginBottom: 14 }}><Alert type="error">{error}</Alert></div>}

        <form onSubmit={handleSubmit}>
          <Input
            label="Your name"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Jane Smith"
            autoFocus
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="At least 8 characters"
          />
          <Input
            label="Confirm password"
            type="password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            placeholder="Repeat password"
          />
          <Button
            type="submit"
            variant="primary"
            loading={submitting}
            style={{ width: '100%', marginTop: 4 }}
          >
            Set password & join
          </Button>
        </form>

        <p style={{ marginTop: 20, textAlign: 'center', fontSize: '0.8125rem', color: 'var(--gray-400)' }}>
          Already have an account?{' '}
          <a href="/login" style={{ color: 'var(--color-primary)' }}>Sign in</a>
        </p>
      </div>
    </div>
  );
}
