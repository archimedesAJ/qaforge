import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/auth';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { ProjectsPage } from './pages/ProjectsPage';
import { DashboardPage } from './pages/DashboardPage';
import { CasesPage } from './pages/CasesPage';
import { RunsPage } from './pages/RunsPage';
import { PlansPage } from './pages/PlansPage';
import { InsightsPage } from './pages/InsightsPage';
import { SettingsPage } from './pages/SettingsPage';
import { AiPage } from './pages/AiPage';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  const hydrate = useAuthStore((s) => s.hydrate);

  useEffect(() => { hydrate(); }, [hydrate]);

  return (
    <Routes>
      <Route path="/login"          element={<LoginPage />} />
      <Route path="/register"       element={<RegisterPage />} />
      <Route path="/accept-invite"  element={<AcceptInvitePage />} />
      <Route path="/"                                   element={<RequireAuth><ProjectsPage /></RequireAuth>} />
      <Route path="/projects/:projectId"                element={<RequireAuth><DashboardPage /></RequireAuth>} />
      <Route path="/projects/:projectId/cases"          element={<RequireAuth><CasesPage /></RequireAuth>} />
      <Route path="/projects/:projectId/runs"           element={<RequireAuth><RunsPage /></RequireAuth>} />
      <Route path="/projects/:projectId/plans"          element={<RequireAuth><PlansPage /></RequireAuth>} />
      <Route path="/projects/:projectId/insights"       element={<RequireAuth><InsightsPage /></RequireAuth>} />
      <Route path="/projects/:projectId/settings"       element={<RequireAuth><SettingsPage /></RequireAuth>} />
      <Route path="/projects/:projectId/ai"             element={<RequireAuth><AiPage /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}