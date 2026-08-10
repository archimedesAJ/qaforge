import { FormEvent, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AppLayout } from '../components/shared/AppLayout';
import { Alert, Button, EmptyState, StatCard } from '../components/shared/ui';
import { api } from '../lib/api';
import { useAuthStore } from '../store/auth';

interface BriefResponse {
  date: string;
  question: string;
  evidenceCount: number;
  totals: { activeProjects: number; runsStarted: number; runsClosed: number; testsExecuted: number; passed: number; failed: number; blocked: number; skipped: number; casesCreated: number; defectsFiled: number; defectsResolved: number; plansCreated: number };
  brief: {
    headline: string;
    summary: string;
    highlights: string[];
    risks: string[];
    projectUpdates: Array<{ project: string; update: string }>;
    peopleActivity: string[];
    followUps: string[];
  };
}

const panel: React.CSSProperties = { background: 'var(--surface-base)', border: '1px solid var(--border-color)', borderRadius: 10, padding: 18 };
function today() { return new Date().toISOString().slice(0, 10); }
function displayDate(value: string) { return new Date(`${value}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); }

function BulletSection({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return <section style={panel}><h3 style={{ marginBottom: 10 }}>{title}</h3>{items.length ? <ul style={{ paddingLeft: 20, color: 'var(--gray-700)', display: 'grid', gap: 7 }}>{items.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p style={{ color: 'var(--gray-400)' }}>{empty}</p>}</section>;
}

export function AdminAiBriefPage() {
  const isSystemAdmin = useAuthStore(state => state.user?.systemAdmin ?? false);
  const [date, setDate] = useState(today());
  const [question, setQuestion] = useState('What is happening today?');
  const mutation = useMutation({
    mutationFn: () => api.post<BriefResponse>('projects/sysadmin/ai-brief', { date, question }),
  });

  if (!isSystemAdmin) return <AppLayout title="AI daily brief"><EmptyState icon="🔒" title="Access denied" description="Only system administrators can generate operational briefs." /></AppLayout>;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (question.trim().length >= 3) mutation.mutate();
  }

  const data = mutation.data;
  return <AppLayout title="AI daily brief">
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div className="page-header"><div><h1 className="page-title">Ask QAForge</h1><p className="page-subtitle">Generate a grounded management brief from the activity recorded in QAForge.</p></div></div>

      <form onSubmit={submit} style={{ ...panel, marginBottom: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '180px minmax(280px,1fr) auto', gap: 12, alignItems: 'end' }}>
          <label className="field" style={{ margin: 0 }}><span className="label">Reporting date</span><input className="input" type="date" value={date} max={today()} onChange={event => setDate(event.target.value)} /></label>
          <label className="field" style={{ margin: 0 }}><span className="label">Ask about the day</span><input className="input" value={question} maxLength={500} placeholder="What happened today? Which projects need attention?" onChange={event => setQuestion(event.target.value)} /></label>
          <Button type="submit" variant="primary" loading={mutation.isPending} disabled={question.trim().length < 3}>{mutation.isPending ? 'Reviewing activity…' : 'Ask AI'}</Button>
        </div>
        <p style={{ marginTop: 10, fontSize: '0.78rem', color: 'var(--gray-500)' }}>The AI receives a limited factual summary for this date—not database access. Always verify important decisions against the linked QAForge records.</p>
      </form>

      {mutation.isError && <Alert type="error">{mutation.error instanceof Error ? mutation.error.message : 'Unable to generate the daily brief.'}</Alert>}

      {!data && !mutation.isPending && <EmptyState icon="✦" title="Ask what is happening" description="QAForge will compile runs, executions, cases, defects, plans and recorded team activity for the selected day." />}

      {data && <>
        <section style={{ ...panel, marginBottom: 16, borderLeft: '4px solid var(--color-primary)' }}>
          <div style={{ color: 'var(--gray-500)', fontSize: '0.8rem', marginBottom: 5 }}>{displayDate(data.date)} · {data.evidenceCount} activity log entries used</div>
          <h2 style={{ marginBottom: 8 }}>{data.brief.headline}</h2>
          <p style={{ color: 'var(--gray-700)', margin: 0 }}>{data.brief.summary}</p>
        </section>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(145px,1fr))', gap: 10, marginBottom: 16 }}>
          <StatCard label="Active projects" value={data.totals.activeProjects} />
          <StatCard label="Tests executed" value={data.totals.testsExecuted} sub={`${data.totals.passed} passed`} />
          <StatCard label="Runs started" value={data.totals.runsStarted} sub={`${data.totals.runsClosed} closed`} />
          <StatCard label="Cases created" value={data.totals.casesCreated} />
          <StatCard label="Defects filed" value={data.totals.defectsFiled} sub={`${data.totals.defectsResolved} resolved`} />
          <StatCard label="Failed / blocked" value={`${data.totals.failed} / ${data.totals.blocked}`} color={data.totals.failed || data.totals.blocked ? '#dc2626' : '#16a34a'} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(360px,1fr))', gap: 14, marginBottom: 14 }}>
          <BulletSection title="Highlights" items={data.brief.highlights} empty="No highlights were supported by today's records." />
          <BulletSection title="Risks and attention" items={data.brief.risks} empty="No evidence-based risks were identified." />
        </div>

        <section style={{ ...panel, marginBottom: 14 }}><h3 style={{ marginBottom: 10 }}>Project updates</h3>{data.brief.projectUpdates.length ? <div style={{ display: 'grid', gap: 9 }}>{data.brief.projectUpdates.map(update => <div key={`${update.project}-${update.update}`} style={{ paddingBottom: 9, borderBottom: '1px solid var(--border-color)' }}><strong>{update.project}</strong><p style={{ margin: '3px 0 0' }}>{update.update}</p></div>)}</div> : <p style={{ color: 'var(--gray-400)' }}>No project updates were recorded.</p>}</section>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(360px,1fr))', gap: 14 }}>
          <BulletSection title="Recorded team activity" items={data.brief.peopleActivity} empty="No named team activity was available." />
          <BulletSection title="Suggested follow-ups" items={data.brief.followUps} empty="No follow-ups were supported by the records." />
        </div>
      </>}
    </div>
  </AppLayout>;
}
