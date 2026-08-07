import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '../components/shared/AppLayout';
import { Alert, Button, Modal, Spinner, StatCard } from '../components/shared/ui';
import { api } from '../lib/api';

type Preset = '7' | '30' | 'custom';
interface InactiveProject {
  id: string;
  name: string;
  slug: string;
  category: string | null;
  stage: string | null;
  createdAt: string;
  lastActivityAt: string;
  lastActivityType: string;
  daysInactive: number;
  counts: { cases: number; runs: number; defects: number; plans: number; members: number };
}
interface InactiveResponse {
  since: string;
  until: string;
  totalProjects: number;
  activeProjects: number;
  inactiveProjects: number;
  active: InactiveProject[];
  inactive: InactiveProject[];
}

const dayMs = 86_400_000;
function isoDate(date: Date) { return date.toISOString().slice(0, 10); }
function displayDate(value: string) { return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
function displayLabel(value: string | null) { return value ? value.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase()) : '—'; }

function exportCsv(rows: InactiveProject[], from: string, to: string) {
  const data = rows.map(row => ({
    Project: row.name,
    Stage: row.stage ?? '',
    Category: row.category ?? '',
    'Last activity': row.lastActivityAt,
    'Last activity type': row.lastActivityType,
    'Days inactive': row.daysInactive,
    'Test cases': row.counts.cases,
    Runs: row.counts.runs,
    Defects: row.counts.defects,
    Plans: row.counts.plans,
    Members: row.counts.members,
  }));
  if (!data.length) return;
  const headers = Object.keys(data[0]);
  const quote = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.map(quote).join(','), ...data.map(row => headers.map(header => quote(row[header as keyof typeof row])).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `inactive-projects-${from}-to-${to}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function InactiveProjectsPage() {
  const today = new Date();
  const [preset, setPreset] = useState<Preset>('7');
  const [customFrom, setCustomFrom] = useState(isoDate(new Date(today.getTime() - 7 * dayMs)));
  const [customTo, setCustomTo] = useState(isoDate(today));
  const [showActive, setShowActive] = useState(false);
  const to = preset === 'custom' ? customTo : isoDate(today);
  const from = preset === 'custom' ? customFrom : isoDate(new Date(today.getTime() - (Number(preset) - 1) * dayMs));

  const query = useQuery({
    queryKey: ['inactive-projects', from, to],
    queryFn: () => api.get<InactiveResponse>(`projects/sysadmin/inactive-projects?since=${from}&until=${to}`),
    enabled: Boolean(from && to && from <= to),
  });
  const data = query.data;

  return <AppLayout title="Inactive projects">
    <div style={{ maxWidth: 1300, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Inactive Projects</h1>
          <p className="page-subtitle">Projects with no test run, test-case, defect, resolution, or test-plan activity during the selected period.</p>
        </div>
        {data && <Button variant="secondary" onClick={() => exportCsv(data.inactive, from, to)} disabled={!data.inactive.length}>Export CSV</Button>}
      </div>

      <section className="card" style={{ padding: 18, marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
          {([['7', 'Last 7 days'], ['30', 'Last 30 days'], ['custom', 'Custom']] as Array<[Preset, string]>).map(([value, text]) =>
            <Button key={value} size="sm" variant={preset === value ? 'primary' : 'secondary'} onClick={() => setPreset(value)}>{text}</Button>
          )}
          {preset === 'custom' && <>
            <label style={{ display: 'grid', gap: 5 }}><span className="label">From</span><input className="input" type="date" value={customFrom} max={customTo} onChange={event => setCustomFrom(event.target.value)} /></label>
            <label style={{ display: 'grid', gap: 5 }}><span className="label">To</span><input className="input" type="date" value={customTo} min={customFrom} max={isoDate(today)} onChange={event => setCustomTo(event.target.value)} /></label>
          </>}
          <span style={{ marginLeft: 'auto', color: 'var(--gray-500)', fontSize: '0.84rem' }}>{displayDate(from)} – {displayDate(to)}</span>
        </div>
      </section>

      {query.isLoading && <div style={{ display: 'flex', justifyContent: 'center', padding: 70 }}><Spinner size="lg" /></div>}
      {query.isError && <Alert type="error">Unable to query inactive projects. Please retry.</Alert>}

      {data && <>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 12, marginBottom: 18 }}>
          <StatCard label="All projects" value={data.totalProjects} />
          <button
            type="button"
            onClick={() => setShowActive(true)}
            disabled={!data.active.length}
            title="View active projects"
            style={{ appearance: 'none', border: 0, padding: 0, background: 'transparent', textAlign: 'left', cursor: data.active.length ? 'pointer' : 'default' }}
          >
            <StatCard label="Active in period — click to view" value={data.activeProjects} color="#16a34a" />
          </button>
          <StatCard label="Inactive in period" value={data.inactiveProjects} color={data.inactiveProjects ? '#dc2626' : '#16a34a'} />
        </div>

        <Modal open={showActive} onClose={() => setShowActive(false)} title={`Active projects (${data.active.length})`} maxWidth={900}>
          <p style={{ margin: '0 0 16px', color: 'var(--gray-500)', fontSize: '0.875rem' }}>
            Projects that recorded QA activity from {displayDate(from)} to {displayDate(to)}.
          </p>
          <div style={{ overflowX: 'auto', maxHeight: '60vh' }}>
            <table className="table">
              <thead><tr><th>Project</th><th>Stage</th><th>Latest activity</th><th>Activity type</th><th>Cases</th><th>Runs</th><th>Defects</th></tr></thead>
              <tbody>{data.active.map(project => <tr key={project.id}>
                <td><Link to={`/projects/${project.id}`} onClick={() => setShowActive(false)}>{project.name}</Link><div style={{ color: 'var(--gray-400)', fontSize: '0.75rem' }}>{project.category ?? 'Uncategorised'}</div></td>
                <td>{displayLabel(project.stage)}</td>
                <td>{displayDate(project.lastActivityAt)}</td>
                <td>{displayLabel(project.lastActivityType)}</td>
                <td>{project.counts.cases}</td><td>{project.counts.runs}</td><td>{project.counts.defects}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </Modal>

        <section className="card" style={{ overflowX: 'auto' }}>
          {data.inactive.length === 0 ?
            <div style={{ padding: 48, textAlign: 'center' }}><h3>No inactive projects</h3><p style={{ color: 'var(--gray-500)', marginTop: 8 }}>Every project recorded activity in this period.</p></div> :
            <table className="table">
              <thead><tr><th>Project</th><th>Stage</th><th>Last activity</th><th>Activity type</th><th>Inactive</th><th>Cases</th><th>Runs</th><th>Defects</th><th>Members</th></tr></thead>
              <tbody>{data.inactive.map(project => <tr key={project.id}>
                <td><Link to={`/projects/${project.id}`}>{project.name}</Link><div style={{ color: 'var(--gray-400)', fontSize: '0.75rem' }}>{project.category ?? 'Uncategorised'}</div></td>
                <td>{displayLabel(project.stage)}</td>
                <td>{displayDate(project.lastActivityAt)}</td>
                <td>{displayLabel(project.lastActivityType)}</td>
                <td><strong style={{ color: project.daysInactive >= 30 ? '#dc2626' : '#d97706' }}>{project.daysInactive} days</strong></td>
                <td>{project.counts.cases}</td><td>{project.counts.runs}</td><td>{project.counts.defects}</td><td>{project.counts.members}</td>
              </tr>)}</tbody>
            </table>
          }
        </section>
      </>}
    </div>
  </AppLayout>;
}
