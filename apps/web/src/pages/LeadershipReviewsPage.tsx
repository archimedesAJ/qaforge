import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '../components/shared/AppLayout';
import { Alert, Button, EmptyState, Input, Modal, Select, Spinner, StatCard } from '../components/shared/ui';
import { api } from '../lib/api';
import { useAuthStore } from '../store/auth';

type Tab = 'reviews' | 'one-on-ones';
interface Person { id: string; name: string; email: string }
interface AdminPerson extends Person { activated: boolean }
interface Meeting { id: string; meetingDate: string; nextMeetingDate?: string | null; presentationSummary?: string | null; report: Person }
interface ReviewListItem { id: string; department: string; unitName: string; reportingPeriod: string; meetingDate?: string | null; status: string; _count: { entries: number } }
interface ReviewEntry {
  id: string; employee: Person; jobTitle?: string | null; teamUnit?: string | null; ldHours: number;
  tasksAchieved: string[]; inProgress: string[]; planned: string[]; oneOnOneSummary: string[];
  learningDevelopment: string[]; managerFeedback: string[];
}
interface ReviewDetail extends ReviewListItem {
  presenter: Person; entries: ReviewEntry[];
  unitHighlights: string[]; nextPeriodFocus: string[]; workingFeedback: string[];
  challengesSupport: string[]; crossTeamDependencies: string[]; followUps: string[];
  decisionsActions: { action: string; owner?: string; dueDate?: string; status?: string }[];
  nextMeetingDate?: string | null;
}

const lines = (value: string) => value.split('\n').map(item => item.trim()).filter(Boolean);
const text = (value?: string[] | null) => (value ?? []).join('\n');
const monthValue = () => new Date().toISOString().slice(0, 7);

function BulletField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <div>
    <label className="label">{label}</label>
    <textarea className="input" rows={4} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder ?? 'One bullet per line'} style={{ resize: 'vertical' }} />
  </div>;
}

export function LeadershipReviewsPage() {
  const isSystemAdmin = useAuthStore(state => state.user?.systemAdmin === true);
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('reviews');
  const [showReview, setShowReview] = useState(false);
  const [showMeeting, setShowMeeting] = useState(false);
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const usersQuery = useQuery({
    queryKey: ['sysadmin-users'],
    queryFn: () => api.get<{ users: AdminPerson[] }>('projects/sysadmin/users'),
    enabled: isSystemAdmin,
  });
  const reviewsQuery = useQuery({ queryKey: ['leadership-reviews'], queryFn: () => api.get<{ reviews: ReviewListItem[] }>('leadership/reviews'), enabled: isSystemAdmin });
  const meetingsQuery = useQuery({ queryKey: ['leadership-one-on-ones'], queryFn: () => api.get<{ meetings: Meeting[] }>('leadership/one-on-ones'), enabled: isSystemAdmin });

  if (!isSystemAdmin) return <Navigate to="/" replace />;
  const users = (usersQuery.data?.users ?? []).filter(user => user.activated);
  const reviews = reviewsQuery.data?.reviews ?? [];
  const meetings = meetingsQuery.data?.meetings ?? [];

  return <AppLayout title="Leadership Reviews" actions={<div style={{ display: 'flex', gap: 8 }}>
    <Button variant="secondary" size="sm" onClick={() => { setError(''); setShowMeeting(true); }}>+ Record one-on-one</Button>
    <Button variant="primary" size="sm" onClick={() => { setError(''); setShowReview(true); }}>+ Monthly review</Button>
  </div>}>
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border-color)' }}>
        {[['reviews', 'Monthly reviews'], ['one-on-ones', 'One-on-ones']].map(([value, label]) => <button key={value} onClick={() => setTab(value as Tab)} style={{ padding: '9px 16px', border: 'none', borderBottom: tab === value ? '2px solid var(--color-primary)' : '2px solid transparent', background: 'none', color: tab === value ? 'var(--color-primary)' : 'var(--gray-500)', cursor: 'pointer', fontWeight: 600 }}>{label}</button>)}
      </div>

      {activeReviewId ? <ReviewEditor reviewId={activeReviewId} onBack={() => setActiveReviewId(null)} /> : tab === 'reviews' ? <>
        <div className="grid-4" style={{ marginBottom: 20 }}>
          <StatCard label="Total reviews" value={reviews.length} />
          <StatCard label="Draft" value={reviews.filter(review => review.status === 'draft').length} color="var(--color-warning)" />
          <StatCard label="Ready" value={reviews.filter(review => review.status === 'ready').length} color="var(--color-primary)" />
          <StatCard label="Presented" value={reviews.filter(review => ['presented', 'closed'].includes(review.status)).length} color="var(--color-success)" />
        </div>
        <div className="card">
          {reviewsQuery.isLoading && <div style={{ padding: 32 }}><Spinner /></div>}
          {reviewsQuery.isError && <QueryError message={reviewsQuery.error.message} onRetry={() => reviewsQuery.refetch()} />}
          {reviewsQuery.isSuccess && reviews.length === 0 && <EmptyState icon="◆" title="No monthly reviews" description="Create a review and select your direct reports." action={<Button variant="primary" onClick={() => setShowReview(true)}>Create first review</Button>} />}
          {reviews.map(review => <div key={review.id} style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--border-color)', gap: 14 }}>
            <div style={{ flex: 1 }}><div style={{ fontWeight: 600 }}>{review.unitName}</div><div style={{ fontSize: '0.8125rem', color: 'var(--gray-400)', marginTop: 3 }}>{review.department} · {new Date(review.reportingPeriod).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })} · {review._count.entries} direct report(s)</div></div>
            <span style={{ fontSize: '0.75rem', textTransform: 'capitalize', padding: '3px 9px', borderRadius: 12, background: 'var(--gray-100)' }}>{review.status}</span>
            <Button variant="secondary" size="sm" onClick={() => setActiveReviewId(review.id)}>Open</Button>
          </div>)}
        </div>
      </> : <div className="card">
        {meetingsQuery.isLoading && <div style={{ padding: 32 }}><Spinner /></div>}
        {meetingsQuery.isError && <QueryError message={meetingsQuery.error.message} onRetry={() => meetingsQuery.refetch()} />}
        {meetingsQuery.isSuccess && meetings.length === 0 && <EmptyState icon="◉" title="No one-on-ones recorded" description="Record the first meeting with a direct report." action={<Button variant="primary" onClick={() => setShowMeeting(true)}>Record first one-on-one</Button>} />}
        {meetings.map(meeting => <div key={meeting.id} style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><strong>{meeting.report.name}</strong><span style={{ color: 'var(--gray-500)', fontSize: '0.8125rem' }}>{new Date(meeting.meetingDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</span></div>
          {meeting.presentationSummary && <div style={{ marginTop: 6, fontSize: '0.875rem', color: 'var(--gray-600)' }}>{meeting.presentationSummary}</div>}
        </div>)}
      </div>}
    </div>
    <CreateReviewModal open={showReview} users={users} usersLoading={usersQuery.isLoading} usersError={usersQuery.isError ? usersQuery.error.message : ''} retryUsers={() => usersQuery.refetch()} error={error} setError={setError} onClose={() => setShowReview(false)} onCreated={id => { qc.invalidateQueries({ queryKey: ['leadership-reviews'] }); setShowReview(false); setActiveReviewId(id); }} />
    <CreateMeetingModal open={showMeeting} users={users} usersLoading={usersQuery.isLoading} usersError={usersQuery.isError ? usersQuery.error.message : ''} retryUsers={() => usersQuery.refetch()} error={error} setError={setError} onClose={() => setShowMeeting(false)} onCreated={() => { qc.invalidateQueries({ queryKey: ['leadership-one-on-ones'] }); setShowMeeting(false); setTab('one-on-ones'); }} />
  </AppLayout>;
}

function QueryError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div style={{ padding: 24 }}><Alert type="error">Unable to load this section: {message}</Alert><div style={{ marginTop: 12 }}><Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button></div></div>;
}

interface UserPickerProps { users: Person[]; usersLoading: boolean; usersError: string; retryUsers: () => void }

function CreateReviewModal({ open, users, usersLoading, usersError, retryUsers, error, setError, onClose, onCreated }: UserPickerProps & { open: boolean; error: string; setError: (value: string) => void; onClose: () => void; onCreated: (id: string) => void }) {
  const [department, setDepartment] = useState(''); const [unitName, setUnitName] = useState('QA'); const [period, setPeriod] = useState(monthValue()); const [meetingDate, setMeetingDate] = useState(''); const [selected, setSelected] = useState<string[]>([]);
  const create = useMutation({ mutationFn: () => api.post<ReviewDetail>('leadership/reviews', { department, unitName, reportingPeriod: `${period}-01`, meetingDate: meetingDate || undefined, reportIds: selected }), onSuccess: review => onCreated(review.id), onError: (err: Error) => setError(err.message) });
  return <Modal open={open} onClose={onClose} title="Create monthly leadership review" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" loading={create.isPending} onClick={() => { if (!department.trim() || !unitName.trim() || !period || !selected.length) { setError('Department, unit, reporting period, and at least one direct report are required.'); return; } create.mutate(); }}>Create review</Button></>}>
    {error && <div style={{ marginBottom: 12 }}><Alert type="error">{error}</Alert></div>}
    <Input label="Department" value={department} onChange={event => setDepartment(event.target.value)} placeholder="e.g. Technology" />
    <Input label="Unit / team" value={unitName} onChange={event => setUnitName(event.target.value)} placeholder="e.g. Quality Assurance" />
    <Input label="Reporting period" type="month" value={period} onChange={event => setPeriod(event.target.value)} />
    <Input label="Meeting date (optional)" type="date" value={meetingDate} onChange={event => setMeetingDate(event.target.value)} />
    <label className="label">Direct reports</label>
    {usersLoading ? <div style={{ padding: 18, textAlign: 'center' }}><Spinner /></div> : usersError ? <QueryError message={usersError} onRetry={retryUsers} /> : users.length === 0 ? <Alert type="info">No activated users are available.</Alert> : <div style={{ maxHeight: 190, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 7 }}>{users.map(user => <label key={user.id} style={{ display: 'flex', gap: 9, padding: '8px 10px', borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}><input type="checkbox" checked={selected.includes(user.id)} onChange={event => setSelected(current => event.target.checked ? [...current, user.id] : current.filter(id => id !== user.id))} /><span><strong>{user.name}</strong><span style={{ color: 'var(--gray-400)', marginLeft: 6, fontSize: '0.8125rem' }}>{user.email}</span></span></label>)}</div>}
  </Modal>;
}

function CreateMeetingModal({ open, users, usersLoading, usersError, retryUsers, error, setError, onClose, onCreated }: UserPickerProps & { open: boolean; error: string; setError: (value: string) => void; onClose: () => void; onCreated: () => void }) {
  const [reportId, setReportId] = useState(''); const [meetingDate, setMeetingDate] = useState(new Date().toISOString().slice(0, 10)); const [wins, setWins] = useState(''); const [discussion, setDiscussion] = useState(''); const [challenges, setChallenges] = useState(''); const [learning, setLearning] = useState(''); const [feedback, setFeedback] = useState(''); const [summary, setSummary] = useState(''); const [privateNotes, setPrivateNotes] = useState(''); const [nextDate, setNextDate] = useState('');
  const create = useMutation({ mutationFn: () => api.post('leadership/one-on-ones', { reportId, meetingDate, wins: lines(wins), discussionPoints: lines(discussion), challenges: lines(challenges), learningDevelopment: lines(learning), managerFeedback: lines(feedback), actions: [], presentationSummary: summary || undefined, privateNotes: privateNotes || undefined, nextMeetingDate: nextDate || undefined }), onSuccess: onCreated, onError: (err: Error) => setError(err.message) });
  return <Modal open={open} onClose={onClose} title="Record one-on-one" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" loading={create.isPending} onClick={() => { if (!reportId || !meetingDate) { setError('Direct report and meeting date are required.'); return; } create.mutate(); }}>Save meeting</Button></>}>
    {error && <div style={{ marginBottom: 12 }}><Alert type="error">{error}</Alert></div>}
    {usersLoading ? <div style={{ padding: 18, textAlign: 'center' }}><Spinner /></div> : usersError ? <QueryError message={usersError} onRetry={retryUsers} /> : users.length === 0 ? <Alert type="info">No activated users are available.</Alert> : <Select label="Direct report" value={reportId} onChange={event => setReportId(event.target.value)} options={[{ value: '', label: 'Select a user' }, ...users.map(user => ({ value: user.id, label: `${user.name} (${user.email})` }))]} />}
    <Input label="Meeting date" type="date" value={meetingDate} onChange={event => setMeetingDate(event.target.value)} />
    <BulletField label="Wins and progress" value={wins} onChange={setWins} /><BulletField label="Discussion points" value={discussion} onChange={setDiscussion} /><BulletField label="Challenges" value={challenges} onChange={setChallenges} /><BulletField label="Learning & development" value={learning} onChange={setLearning} /><BulletField label="Manager feedback" value={feedback} onChange={setFeedback} />
    <Input label="Presentation-safe summary" value={summary} onChange={event => setSummary(event.target.value)} placeholder="Only content suitable for the leadership review" />
    <label className="label">Private notes</label><textarea className="input" rows={3} value={privateNotes} onChange={event => setPrivateNotes(event.target.value)} />
    <Input label="Next meeting date (optional)" type="date" value={nextDate} onChange={event => setNextDate(event.target.value)} />
  </Modal>;
}

function ReviewEditor({ reviewId, onBack }: { reviewId: string; onBack: () => void }) {
  const qc = useQueryClient(); const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null); const [message, setMessage] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['leadership-review', reviewId], queryFn: () => api.get<ReviewDetail>(`leadership/reviews/${reviewId}`) });
  const updateReview = useMutation({ mutationFn: (body: unknown) => api.patch(`leadership/reviews/${reviewId}`, body), onSuccess: () => { qc.invalidateQueries({ queryKey: ['leadership-review', reviewId] }); qc.invalidateQueries({ queryKey: ['leadership-reviews'] }); setMessage('Saved.'); } });
  if (isLoading || !data) return <div style={{ padding: 40, textAlign: 'center' }}><Spinner /></div>;
  const entry = data.entries.find(item => item.id === selectedEntryId);
  return <div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}><Button variant="ghost" size="sm" onClick={onBack}>← Reviews</Button><div style={{ flex: 1 }}><h2 style={{ margin: 0, fontSize: '1.1rem' }}>{data.unitName} · {new Date(data.reportingPeriod).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h2><div style={{ color: 'var(--gray-400)', fontSize: '0.8125rem', marginTop: 3 }}>{data.department} · Presented by {data.presenter.name}</div></div><Button variant="secondary" size="sm" onClick={() => api.download(`leadership/reviews/${reviewId}/export/pptx`)}>↓ PowerPoint</Button><Select value={data.status} onChange={event => updateReview.mutate({ status: event.target.value })} options={['draft', 'ready', 'presented', 'closed'].map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) }))} /> </div>
    {message && <div style={{ marginBottom: 12 }}><Alert type="success">{message}</Alert></div>}
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 16 }}>
      <div className="card" style={{ alignSelf: 'start' }}><div style={{ padding: '12px 14px', fontWeight: 600, borderBottom: '1px solid var(--border-color)' }}>Report sections</div><button onClick={() => setSelectedEntryId(null)} style={sectionButton(!selectedEntryId)}>Unit summary</button>{data.entries.map(item => <button key={item.id} onClick={() => setSelectedEntryId(item.id)} style={sectionButton(selectedEntryId === item.id)}>{item.employee.name}</button>)}</div>
      {entry ? <EntryEditor key={entry.id} reviewId={reviewId} entry={entry} onSaved={() => qc.invalidateQueries({ queryKey: ['leadership-review', reviewId] })} /> : <UnitEditor review={data} onSave={body => updateReview.mutate(body)} saving={updateReview.isPending} />}
    </div>
  </div>;
}

const sectionButton = (active: boolean): React.CSSProperties => ({ display: 'block', width: '100%', padding: '10px 14px', border: 'none', borderBottom: '1px solid var(--border-color)', textAlign: 'left', background: active ? 'var(--color-primary-light)' : 'transparent', color: active ? 'var(--color-primary)' : 'var(--gray-700)', cursor: 'pointer', fontWeight: active ? 600 : 400 });

function UnitEditor({ review, onSave, saving }: { review: ReviewDetail; onSave: (body: unknown) => void; saving: boolean }) {
  const [highlights, setHighlights] = useState(text(review.unitHighlights)); const [focus, setFocus] = useState(text(review.nextPeriodFocus)); const [working, setWorking] = useState(text(review.workingFeedback)); const [challenges, setChallenges] = useState(text(review.challengesSupport)); const [dependencies, setDependencies] = useState(text(review.crossTeamDependencies)); const [followUps, setFollowUps] = useState(text(review.followUps)); const [actions, setActions] = useState((review.decisionsActions ?? []).map(item => [item.action, item.owner, item.dueDate].filter(Boolean).join(' | ')).join('\n')); const [nextMeetingDate, setNextMeetingDate] = useState(review.nextMeetingDate?.slice(0, 10) ?? '');
  return <div className="card" style={{ padding: 18 }}><h3 style={{ marginTop: 0 }}>Unit Snapshot, Feedback & Next Steps</h3><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}><BulletField label="Unit highlights" value={highlights} onChange={setHighlights} /><BulletField label="Focus for next period" value={focus} onChange={setFocus} /><BulletField label="What's working / feedback" value={working} onChange={setWorking} /><BulletField label="Challenges & support needed" value={challenges} onChange={setChallenges} /><BulletField label="Cross-team dependencies" value={dependencies} onChange={setDependencies} /><BulletField label="Follow-ups" value={followUps} onChange={setFollowUps} /><BulletField label="Decisions & actions" value={actions} onChange={setActions} placeholder="Action | Owner | YYYY-MM-DD" /><Input label="Next meeting date" type="date" value={nextMeetingDate} onChange={event => setNextMeetingDate(event.target.value)} /></div><div style={{ marginTop: 16 }}><Button variant="primary" loading={saving} onClick={() => onSave({ unitHighlights: lines(highlights), nextPeriodFocus: lines(focus), workingFeedback: lines(working), challengesSupport: lines(challenges), crossTeamDependencies: lines(dependencies), followUps: lines(followUps), decisionsActions: lines(actions).map(line => { const [action, owner, dueDate] = line.split('|').map(value => value.trim()); return { action, owner: owner || undefined, dueDate: dueDate || undefined, status: 'open' }; }), nextMeetingDate: nextMeetingDate || null })}>Save unit sections</Button></div></div>;
}

function EntryEditor({ reviewId, entry, onSaved }: { reviewId: string; entry: ReviewEntry; onSaved: () => void }) {
  const [jobTitle, setJobTitle] = useState(entry.jobTitle ?? ''); const [teamUnit, setTeamUnit] = useState(entry.teamUnit ?? ''); const [achieved, setAchieved] = useState(text(entry.tasksAchieved)); const [progress, setProgress] = useState(text(entry.inProgress)); const [planned, setPlanned] = useState(text(entry.planned)); const [oneOnOne, setOneOnOne] = useState(text(entry.oneOnOneSummary)); const [learning, setLearning] = useState(text(entry.learningDevelopment)); const [feedback, setFeedback] = useState(text(entry.managerFeedback)); const [ldHours, setLdHours] = useState(String(entry.ldHours)); const [saved, setSaved] = useState(false);
  const save = useMutation({ mutationFn: () => api.patch(`leadership/reviews/${reviewId}/entries/${entry.id}`, { jobTitle, teamUnit, tasksAchieved: lines(achieved), inProgress: lines(progress), planned: lines(planned), oneOnOneSummary: lines(oneOnOne), learningDevelopment: lines(learning), managerFeedback: lines(feedback), ldHours: Number(ldHours) || 0 }), onSuccess: () => { setSaved(true); onSaved(); } });
  return <div className="card" style={{ padding: 18 }}><h3 style={{ marginTop: 0 }}>{entry.employee.name}</h3>{saved && <div style={{ marginBottom: 12 }}><Alert type="success">Direct-report slide saved.</Alert></div>}<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}><Input label="Job title" value={jobTitle} onChange={event => setJobTitle(event.target.value)} /><Input label="Team / unit" value={teamUnit} onChange={event => setTeamUnit(event.target.value)} /><BulletField label="Tasks Achieved" value={achieved} onChange={setAchieved} /><BulletField label="In Progress" value={progress} onChange={setProgress} /><BulletField label="Planned" value={planned} onChange={setPlanned} /><BulletField label="One-on-One" value={oneOnOne} onChange={setOneOnOne} /><BulletField label="Learning & Development" value={learning} onChange={setLearning} /><BulletField label="Manager Feedback" value={feedback} onChange={setFeedback} /><Input label="L&D hours" type="number" value={ldHours} onChange={event => setLdHours(event.target.value)} /></div><div style={{ marginTop: 16 }}><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save direct-report slide</Button></div></div>;
}
