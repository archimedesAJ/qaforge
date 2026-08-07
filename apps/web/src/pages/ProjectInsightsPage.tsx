import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { AppLayout } from '../components/shared/AppLayout';
import { Alert, Button, Spinner, StatCard } from '../components/shared/ui';
import { api } from '../lib/api';

interface ProjectOption { id: string; name: string }
interface NamedValue { name: string; value: number }
interface Report {
  project: { id: string; name: string; stage: string; category: string };
  environments: string[];
  summary: { totalCases: number; runs: number; executedCases: number; results: number; passRate: number | null; defectsCreated: number; defectsResolved: number; openDefects: number; staleCases: number; averageResolutionHours: number | null };
  executionStatus: NamedValue[];
  defectsBySeverity: NamedValue[];
  defectsByStatus: NamedValue[];
  trends: Array<{ date: string; executed: number; passRate: number | null; defectsCreated: number; defectsResolved: number }>;
  coverageByType: Array<{ name: string; total: number; executed: number }>;
  traceability: NamedValue[];
  runs: Array<{ id: string; name: string; env: string; source: string; status: string; startedAt: string; owner: { name: string; email: string } | null; assignedCases: number; resultCount: number; counts: Record<string, number> }>;
  defects: Array<{ id: string; title: string; severity: string; status: string; detectedEnvironment: string; createdAt: string; resolvedAt: string | null; externalRef: string | null; runResult: { testCase: { title: string }; run: { name: string } } | null }>;
}

const COLORS = ['#2563eb', '#16a34a', '#dc2626', '#d97706', '#7c3aed', '#64748b'];
const panel: React.CSSProperties = { background: 'var(--surface-base)', border: '1px solid var(--border-color)', borderRadius: 10, padding: 18, minWidth: 0 };
const input: React.CSSProperties = { height: 38, padding: '0 10px', border: '1px solid var(--border-color)', borderRadius: 7, background: 'var(--surface-base)', color: 'var(--gray-900)' };

function isoDate(date: Date) { return date.toISOString().slice(0, 10); }
function displayDate(value: string) { return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
function label(value: string) { return value.replace(/_/g, ' ').replace(/\b\w/g, (char: string) => char.toUpperCase()); }

function ChartPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section style={panel}><h3 style={{ fontSize: '0.95rem', marginBottom: 14 }}>{title}</h3><div style={{ height: 260 }}>{children}</div></section>;
}

function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.map(escape).join(','), ...rows.map(row => headers.map(key => escape(row[key])).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
}

export function ProjectInsightsPage() {
  const now = new Date();
  const [projectId, setProjectId] = useState('');
  const [from, setFrom] = useState(isoDate(new Date(now.getTime() - 29 * 86_400_000)));
  const [to, setTo] = useState(isoDate(now));
  const [environment, setEnvironment] = useState('');
  const [severity, setSeverity] = useState('');
  const [status, setStatus] = useState('');

  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: () => api.get<{ projects: ProjectOption[] }>('projects') });
  useEffect(() => { if (!projectId && projectsQuery.data?.projects[0]) setProjectId(projectsQuery.data.projects[0].id); }, [projectId, projectsQuery.data]);
  const reportQuery = useQuery({
    queryKey: ['project-insights', projectId, from, to, environment],
    queryFn: () => api.get<Report>(`projects/sysadmin/project-insights?projectId=${encodeURIComponent(projectId)}&since=${from}&until=${to}${environment ? `&environment=${encodeURIComponent(environment)}` : ''}`),
    enabled: Boolean(projectId && from && to),
  });
  const report = reportQuery.data;
  const defects = useMemo(() => report?.defects.filter(defect => (!severity || defect.severity === severity) && (!status || defect.status === status)) ?? [], [report, severity, status]);

  return <AppLayout title="Project insights">
    <div style={{ maxWidth: 1500, margin: '0 auto' }}>
      <div className="page-header">
        <div><h1 className="page-title">Project Insights</h1><p className="page-subtitle">Detailed execution, quality, coverage and traceability reporting for one project.</p></div>
      </div>

      <section style={{ ...panel, display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap', marginBottom: 18 }}>
        <label style={{ display: 'grid', gap: 5, flex: '1 1 280px' }}><span className="label">Project</span><select style={input} value={projectId} onChange={e => { setProjectId(e.target.value); setEnvironment(''); }}><option value="">Select project</option>{projectsQuery.data?.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        <label style={{ display: 'grid', gap: 5 }}><span className="label">From</span><input style={input} type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} /></label>
        <label style={{ display: 'grid', gap: 5 }}><span className="label">To</span><input style={input} type="date" value={to} min={from} max={isoDate(now)} onChange={e => setTo(e.target.value)} /></label>
        <label style={{ display: 'grid', gap: 5, minWidth: 180 }}><span className="label">Environment</span><select style={input} value={environment} onChange={e => setEnvironment(e.target.value)}><option value="">All environments</option>{report?.environments.map(env => <option key={env}>{env}</option>)}</select></label>
      </section>

      {(projectsQuery.isLoading || reportQuery.isLoading) && <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spinner size="lg" /></div>}
      {(projectsQuery.isError || reportQuery.isError) && <Alert type="error">The project report could not be loaded. Please retry.</Alert>}

      {report && <>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(155px,1fr))', gap: 12, marginBottom: 18 }}>
          <StatCard label="Test cases" value={report.summary.totalCases} sub={`${report.summary.executedCases} executed`} />
          <StatCard label="Runs" value={report.summary.runs} sub={`${report.summary.results} results`} />
          <StatCard label="Pass rate" value={report.summary.passRate === null ? '—' : `${report.summary.passRate}%`} color={report.summary.passRate !== null && report.summary.passRate >= 90 ? '#16a34a' : '#d97706'} />
          <StatCard label="Defects filed" value={report.summary.defectsCreated} sub={`${report.summary.defectsResolved} resolved`} />
          <StatCard label="Open defects" value={report.summary.openDefects} color={report.summary.openDefects ? '#dc2626' : '#16a34a'} />
          <StatCard label="Stale cases" value={report.summary.staleCases} color={report.summary.staleCases ? '#dc2626' : '#16a34a'} />
          <StatCard label="Avg. resolution" value={report.summary.averageResolutionHours === null ? '—' : `${report.summary.averageResolutionHours}h`} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(360px,1fr))', gap: 14, marginBottom: 18 }}>
          <ChartPanel title="Execution results"><ResponsiveContainer><PieChart><Pie data={report.executionStatus} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} label>{report.executionStatus.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}</Pie><Tooltip formatter={(v, n) => [v, label(String(n))]} /><Legend formatter={v => label(v)} /></PieChart></ResponsiveContainer></ChartPanel>
          <ChartPanel title="Defects by severity"><ResponsiveContainer><PieChart><Pie data={report.defectsBySeverity} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} label>{report.defectsBySeverity.map((_, i) => <Cell key={i} fill={['#991b1b', '#dc2626', '#d97706', '#2563eb'][i]} />)}</Pie><Tooltip /><Legend formatter={v => label(v)} /></PieChart></ResponsiveContainer></ChartPanel>
          <ChartPanel title="Defects by status"><ResponsiveContainer><BarChart data={report.defectsByStatus}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" tickFormatter={label} /><YAxis allowDecimals={false} /><Tooltip labelFormatter={label} /><Bar dataKey="value" name="Defects" fill="#dc2626" /></BarChart></ResponsiveContainer></ChartPanel>
          <ChartPanel title="Execution and quality trend"><ResponsiveContainer><LineChart data={report.trends}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={v => v.slice(5)} /><YAxis yAxisId="count" allowDecimals={false} /><YAxis yAxisId="rate" orientation="right" domain={[0, 100]} /><Tooltip /><Legend /><Line yAxisId="count" type="monotone" dataKey="executed" stroke="#2563eb" /><Line yAxisId="rate" type="monotone" dataKey="passRate" stroke="#16a34a" connectNulls /></LineChart></ResponsiveContainer></ChartPanel>
          <ChartPanel title="Defects created vs resolved"><ResponsiveContainer><LineChart data={report.trends}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={v => v.slice(5)} /><YAxis allowDecimals={false} /><Tooltip /><Legend /><Line type="monotone" dataKey="defectsCreated" stroke="#dc2626" /><Line type="monotone" dataKey="defectsResolved" stroke="#16a34a" /></LineChart></ResponsiveContainer></ChartPanel>
          <ChartPanel title="Coverage by test type"><ResponsiveContainer><BarChart data={report.coverageByType}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis allowDecimals={false} /><Tooltip /><Legend /><Bar dataKey="total" fill="#94a3b8" /><Bar dataKey="executed" fill="#2563eb" /></BarChart></ResponsiveContainer></ChartPanel>
          <ChartPanel title="Traceability funnel"><ResponsiveContainer><BarChart data={report.traceability} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="name" width={120} /><Tooltip /><Bar dataKey="value" fill="#7c3aed" /></BarChart></ResponsiveContainer></ChartPanel>
        </div>

        <section style={{ ...panel, marginBottom: 18, overflowX: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}><h3>Test runs</h3><Button size="sm" onClick={() => downloadCsv(`${report.project.name}-runs.csv`, report.runs.map(run => ({ Name: run.name, Environment: run.env, Status: run.status, Owner: run.owner?.name ?? '', Started: run.startedAt, Assigned: run.assignedCases, Results: run.resultCount, Passed: run.counts.pass ?? 0, Failed: run.counts.fail ?? 0 })))}>Export runs CSV</Button></div>
          <table className="table"><thead><tr><th>Run</th><th>Environment</th><th>Status</th><th>Owner</th><th>Started</th><th>Assigned</th><th>Pass</th><th>Fail</th></tr></thead><tbody>{report.runs.map(run => <tr key={run.id}><td><Link to={`/projects/${report.project.id}/runs`}>{run.name}</Link></td><td>{run.env}</td><td>{label(run.status)}</td><td>{run.owner?.name ?? '—'}</td><td>{displayDate(run.startedAt)}</td><td>{run.assignedCases}</td><td>{run.counts.pass ?? 0}</td><td>{run.counts.fail ?? 0}</td></tr>)}</tbody></table>
        </section>

        <section style={{ ...panel, overflowX: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}><div><h3>Defects</h3><div style={{ display: 'flex', gap: 8, marginTop: 10 }}><select style={input} value={severity} onChange={e => setSeverity(e.target.value)}><option value="">All severities</option>{['critical', 'high', 'medium', 'low'].map(v => <option key={v} value={v}>{label(v)}</option>)}</select><select style={input} value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>{['open', 'in_progress', 'resolved', 'closed', 'wont_fix'].map(v => <option key={v} value={v}>{label(v)}</option>)}</select></div></div><Button size="sm" onClick={() => downloadCsv(`${report.project.name}-defects.csv`, defects.map(defect => ({ Title: defect.title, Severity: defect.severity, Status: defect.status, Environment: defect.detectedEnvironment, Created: defect.createdAt, Resolved: defect.resolvedAt ?? '', Run: defect.runResult?.run.name ?? '', 'Test case': defect.runResult?.testCase.title ?? '', Reference: defect.externalRef ?? '' })))}>Export defects CSV</Button></div>
          <table className="table"><thead><tr><th>Defect</th><th>Severity</th><th>Status</th><th>Environment</th><th>Run / test case</th><th>Created</th></tr></thead><tbody>{defects.map(defect => <tr key={defect.id}><td><Link to={`/projects/${report.project.id}/defects`}>{defect.title}</Link></td><td>{label(defect.severity)}</td><td>{label(defect.status)}</td><td>{label(defect.detectedEnvironment)}</td><td>{defect.runResult ? `${defect.runResult.run.name} / ${defect.runResult.testCase.title}` : '—'}</td><td>{displayDate(defect.createdAt)}</td></tr>)}</tbody></table>
        </section>
      </>}
    </div>
  </AppLayout>;
}
