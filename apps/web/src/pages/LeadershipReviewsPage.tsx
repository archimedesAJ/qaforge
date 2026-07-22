import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '../components/shared/AppLayout';
import { Alert, Button, ConfirmDialog, EmptyState, Input, Modal, Select, Spinner, StatCard } from '../components/shared/ui';
import { api } from '../lib/api';
import { useAuthStore } from '../store/auth';

type Tab = 'reviews' | 'one-on-ones' | 'learning';
interface Person { id: string; name: string; email: string }
interface AdminPerson extends Person {
  activated: boolean;
  systemAdmin: boolean;
  memberships: { role: string }[];
}
interface Meeting {
  id: string; meetingDate: string; nextMeetingDate?: string | null; presentationSummary?: string | null;
  wins: string[]; discussionPoints: string[]; challenges: string[]; learningDevelopment: string[];
  managerFeedback: string[]; actions: { action: string; owner?: string; dueDate?: string; status?: string }[];
  privateNotes?: string | null; report: Person;
}
interface LearningRecord {
  id: string; title: string; type: string; provider?: string | null; skillArea?: string | null; status: string;
  startDate?: string | null; targetCompletionDate?: string | null; completionDate?: string | null; expiryDate?: string | null;
  learningHours: number; evidenceUrl?: string | null; notes?: string | null; employee: Person;
}
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
const addDays = (date: string, days: number) => {
  if (!date) return '';
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const currentMonthRange = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    from: `${year}-${pad(month + 1)}-01`,
    to: `${year}-${pad(month + 1)}-${pad(new Date(year, month + 1, 0).getDate())}`,
  };
};

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
  const [viewMeeting, setViewMeeting] = useState<Meeting | null>(null);
  const [editMeeting, setEditMeeting] = useState<Meeting | null>(null);
  const [confirmDeleteMeeting, setConfirmDeleteMeeting] = useState<Meeting | null>(null);
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [meetingDates, setMeetingDates] = useState(currentMonthRange);

  const usersQuery = useQuery({
    queryKey: ['sysadmin-users'],
    queryFn: () => api.get<{ users: AdminPerson[] }>('projects/sysadmin/users'),
    enabled: isSystemAdmin,
  });
  const reviewsQuery = useQuery({ queryKey: ['leadership-reviews'], queryFn: () => api.get<{ reviews: ReviewListItem[] }>('leadership/reviews'), enabled: isSystemAdmin });
  const meetingsQuery = useQuery({
    queryKey: ['leadership-one-on-ones', meetingDates.from, meetingDates.to],
    queryFn: () => {
      const params = new URLSearchParams();
      if (meetingDates.from) params.set('from', meetingDates.from);
      if (meetingDates.to) params.set('to', meetingDates.to);
      const query = params.toString();
      return api.get<{ meetings: Meeting[] }>(`leadership/one-on-ones${query ? `?${query}` : ''}`);
    },
    enabled: isSystemAdmin,
  });
  const deleteMeeting = useMutation({
    mutationFn: (meetingId: string) => api.delete(`leadership/one-on-ones/${meetingId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leadership-one-on-ones'] }),
    onError: (err: Error) => setError(err.message),
  });

  if (!isSystemAdmin) return <Navigate to="/" replace />;
  const users = (usersQuery.data?.users ?? []).filter(user =>
    user.activated &&
    !user.systemAdmin &&
    user.memberships.length > 0 &&
    user.memberships.some(membership => membership.role === 'editor')
  );
  const reviews = reviewsQuery.data?.reviews ?? [];
  const meetings = meetingsQuery.data?.meetings ?? [];
  const meetingGroups = [...meetings.reduce((groups, meeting) => {
    const month = meeting.meetingDate.slice(0, 7);
    const key = `${meeting.report.id}:${month}`;
    const group = groups.get(key) ?? { key, month, report: meeting.report, meetings: [] as Meeting[] };
    group.meetings.push(meeting);
    groups.set(key, group);
    return groups;
  }, new Map<string, { key: string; month: string; report: Person; meetings: Meeting[] }>()).values()]
    .map(group => ({ ...group, meetings: group.meetings.sort((a, b) => a.meetingDate.localeCompare(b.meetingDate)) }))
    .sort((a, b) => b.meetings[b.meetings.length - 1].meetingDate.localeCompare(a.meetings[a.meetings.length - 1].meetingDate));

  return <AppLayout title="Leadership Reviews" actions={<div style={{ display: 'flex', gap: 8 }}>
    <Button variant="secondary" size="sm" onClick={() => { setError(''); setShowMeeting(true); }}>+ Record one-on-one</Button>
    <Button variant="primary" size="sm" onClick={() => { setError(''); setShowReview(true); }}>+ Monthly review</Button>
  </div>}>
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border-color)' }}>
        {[['reviews', 'Monthly reviews'], ['one-on-ones', 'One-on-ones'], ['learning', 'L&D tracker']].map(([value, label]) => <button key={value} onClick={() => setTab(value as Tab)} style={{ padding: '9px 16px', border: 'none', borderBottom: tab === value ? '2px solid var(--color-primary)' : '2px solid transparent', background: 'none', color: tab === value ? 'var(--color-primary)' : 'var(--gray-500)', cursor: 'pointer', fontWeight: 600 }}>{label}</button>)}
      </div>

      {activeReviewId ? <ReviewEditor reviewId={activeReviewId} onBack={() => setActiveReviewId(null)} /> : tab === 'reviews' ? <>
        <div className="grid-4" style={{ marginBottom: 20 }}>
          <StatCard label="Total reviews" value={reviews.length} />
          <StatCard label="Draft" value={reviews.filter(review => review.status === 'draft').length} color="var(--color-warning)" />
          <StatCard label="Ready" value={reviews.filter(review => review.status === 'ready').length} color="var(--color-primary)" />
          <StatCard label="Presented" value={reviews.filter(review => ['presented', 'closed'].includes(review.status)).length} color="var(--color-success)" />
        </div>
        <div className="card">
          {reviewsQuery.isError && <QueryError message={reviewsQuery.error.message} onRetry={() => reviewsQuery.refetch()} />}
          {!reviewsQuery.isError && reviews.length === 0 && <EmptyState icon="◆" title="No monthly reviews" description="Create a review and select your editor direct reports." action={<Button variant="primary" onClick={() => setShowReview(true)}>Create first review</Button>} />}
          {reviews.map(review => <div key={review.id} style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--border-color)', gap: 14 }}>
            <div style={{ flex: 1 }}><div style={{ fontWeight: 600 }}>{review.unitName}</div><div style={{ fontSize: '0.8125rem', color: 'var(--gray-400)', marginTop: 3 }}>{review.department} · {new Date(review.reportingPeriod).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })} · {review._count.entries} direct report(s)</div></div>
            <span style={{ fontSize: '0.75rem', textTransform: 'capitalize', padding: '3px 9px', borderRadius: 12, background: 'var(--gray-100)' }}>{review.status}</span>
            <Button variant="secondary" size="sm" onClick={() => setActiveReviewId(review.id)}>Open</Button>
          </div>)}
        </div>
      </> : tab === 'one-on-ones' ? <>
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div className="leadership-date-filter">
          <div className="leadership-date-field"><Input label="From" type="date" value={meetingDates.from} onChange={event => setMeetingDates(current => ({ ...current, from: event.target.value }))} /></div>
          <div className="leadership-date-field"><Input label="To" type="date" value={meetingDates.to} onChange={event => setMeetingDates(current => ({ ...current, to: event.target.value }))} /></div>
          <div className="leadership-date-actions">
            <Button variant="secondary" onClick={() => setMeetingDates(currentMonthRange())}>Current month</Button>
            <Button variant="ghost" onClick={() => setMeetingDates({ from: '', to: '' })}>All dates</Button>
          </div>
        </div>
      </div>
      <div>
        {error && !showMeeting && !editMeeting && <div style={{ padding: 16 }}><Alert type="error">{error}</Alert></div>}
        {meetingsQuery.isError && <QueryError message={meetingsQuery.error.message} onRetry={() => meetingsQuery.refetch()} />}
        {!meetingsQuery.isError && meetings.length === 0 && <EmptyState icon="◉" title="No one-on-ones found" description={meetingDates.from || meetingDates.to ? 'No meetings were recorded in the selected date range.' : 'Record the first meeting with an editor direct report.'} action={<Button variant="primary" onClick={() => setShowMeeting(true)}>Record one-on-one</Button>} />}
        {meetingGroups.map(group => <div className="card" key={group.key} style={{ marginBottom: 16, overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '14px 18px', background: 'var(--gray-50)', borderBottom: '1px solid var(--border-color)' }}>
            <strong>{group.report.name} 1:1</strong>
            <span style={{ color: 'var(--gray-500)', fontSize: '0.8125rem' }}>{new Date(`${group.month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })} · {group.meetings.length} {group.meetings.length === 1 ? 'session' : 'sessions'}</span>
          </div>
          {group.meetings.map((meeting, index) => <div key={meeting.id} style={{ padding: '13px 18px', borderBottom: index < group.meetings.length - 1 ? '1px solid var(--border-color)' : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: '0.875rem' }}>Session {index + 1}</div><div style={{ color: 'var(--gray-500)', fontSize: '0.8125rem', marginTop: 3 }}>Meeting: {new Date(meeting.meetingDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} · Next: {meeting.nextMeetingDate ? new Date(meeting.nextMeetingDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Not scheduled'}</div></div><Button variant="ghost" size="sm" onClick={() => setViewMeeting(meeting)}>View</Button><Button variant="secondary" size="sm" onClick={() => { setError(''); setEditMeeting(meeting); }}>Edit</Button><Button variant="danger" size="sm" loading={deleteMeeting.isPending && deleteMeeting.variables === meeting.id} onClick={() => { setError(''); setConfirmDeleteMeeting(meeting); }}>Delete</Button></div>
            {meeting.presentationSummary && <div style={{ marginTop: 6, fontSize: '0.875rem', color: 'var(--gray-600)' }}>{meeting.presentationSummary}</div>}
          </div>)}
        </div>)}
      </div></> : <LearningTracker users={users} />}
    </div>
    <CreateReviewModal open={showReview} users={users} usersLoading={usersQuery.isLoading} usersError={usersQuery.isError ? usersQuery.error.message : ''} retryUsers={() => usersQuery.refetch()} error={error} setError={setError} onClose={() => setShowReview(false)} onCreated={id => { qc.invalidateQueries({ queryKey: ['leadership-reviews'] }); setShowReview(false); setActiveReviewId(id); }} />
    {showMeeting && <MeetingFormModal open users={users} usersLoading={usersQuery.isLoading} usersError={usersQuery.isError ? usersQuery.error.message : ''} retryUsers={() => usersQuery.refetch()} error={error} setError={setError} onClose={() => { setError(''); setShowMeeting(false); }} onSaved={() => { setError(''); qc.invalidateQueries({ queryKey: ['leadership-one-on-ones'] }); setShowMeeting(false); setTab('one-on-ones'); }} />}
    {editMeeting && <MeetingFormModal open meeting={editMeeting} users={users} usersLoading={usersQuery.isLoading} usersError={usersQuery.isError ? usersQuery.error.message : ''} retryUsers={() => usersQuery.refetch()} error={error} setError={setError} onClose={() => { setError(''); setEditMeeting(null); }} onSaved={() => { setError(''); qc.invalidateQueries({ queryKey: ['leadership-one-on-ones'] }); setEditMeeting(null); }} />}
    {viewMeeting && <MeetingDetailModal meeting={viewMeeting} onClose={() => setViewMeeting(null)} onEdit={() => { setError(''); setEditMeeting(viewMeeting); setViewMeeting(null); }} />}
    <ConfirmDialog open={!!confirmDeleteMeeting} title="Delete one-on-one" message={`Permanently delete the one-on-one with ${confirmDeleteMeeting?.report.name ?? 'this direct report'}? This cannot be undone.`} confirmLabel="Delete" onConfirm={() => { if (confirmDeleteMeeting) deleteMeeting.mutate(confirmDeleteMeeting.id); }} onCancel={() => setConfirmDeleteMeeting(null)} />
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
    <div style={{ marginBottom: 14 }}><Alert type="info">QAForge will suggest review content from activity logs, active plans, and presentation-safe one-on-one data for the selected month. You can edit everything before presenting.</Alert></div>
    <Input label="Department" value={department} onChange={event => setDepartment(event.target.value)} placeholder="e.g. Technology" />
    <Input label="Unit / team" value={unitName} onChange={event => setUnitName(event.target.value)} placeholder="e.g. Quality Assurance" />
    <Input label="Reporting period" type="month" value={period} onChange={event => setPeriod(event.target.value)} />
    <Input label="Meeting date (optional)" type="date" value={meetingDate} onChange={event => setMeetingDate(event.target.value)} />
    <label className="label">Direct reports</label>
    {usersLoading ? <div style={{ padding: 18, textAlign: 'center' }}><Spinner /></div> : usersError ? <QueryError message={usersError} onRetry={retryUsers} /> : users.length === 0 ? <Alert type="info">No activated editor users are available.</Alert> : <div style={{ maxHeight: 190, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 7 }}>{users.map(user => <label key={user.id} style={{ display: 'flex', gap: 9, padding: '8px 10px', borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}><input type="checkbox" checked={selected.includes(user.id)} onChange={event => setSelected(current => event.target.checked ? [...current, user.id] : current.filter(id => id !== user.id))} /><span><strong>{user.name}</strong><span style={{ color: 'var(--gray-400)', marginLeft: 6, fontSize: '0.8125rem' }}>{user.email}</span></span></label>)}</div>}
  </Modal>;
}

function MeetingFormModal({ open, meeting, users, usersLoading, usersError, retryUsers, error, setError, onClose, onSaved }: UserPickerProps & { open: boolean; meeting?: Meeting; error: string; setError: (value: string) => void; onClose: () => void; onSaved: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const initialDate = meeting?.meetingDate.slice(0, 10) ?? today;
  const [reportId, setReportId] = useState(meeting?.report.id ?? ''); const [meetingDate, setMeetingDate] = useState(initialDate); const [wins, setWins] = useState(text(meeting?.wins)); const [discussion, setDiscussion] = useState(text(meeting?.discussionPoints)); const [challenges, setChallenges] = useState(text(meeting?.challenges)); const [learning, setLearning] = useState(text(meeting?.learningDevelopment)); const [feedback, setFeedback] = useState(text(meeting?.managerFeedback)); const [summary, setSummary] = useState(meeting?.presentationSummary ?? ''); const [privateNotes, setPrivateNotes] = useState(meeting?.privateNotes ?? ''); const [nextDate, setNextDate] = useState(meeting?.nextMeetingDate?.slice(0, 10) ?? addDays(initialDate, 14));
  const save = useMutation({ mutationFn: () => { const body = { reportId, meetingDate, wins: lines(wins), discussionPoints: lines(discussion), challenges: lines(challenges), learningDevelopment: lines(learning), managerFeedback: lines(feedback), actions: meeting?.actions ?? [], presentationSummary: summary || undefined, privateNotes: privateNotes || undefined, nextMeetingDate: nextDate || undefined }; return meeting ? api.patch(`leadership/one-on-ones/${meeting.id}`, body) : api.post('leadership/one-on-ones', body); }, onSuccess: onSaved, onError: (err: Error) => setError(err.message) });
  return <Modal open={open} onClose={onClose} title={meeting ? 'Edit one-on-one' : 'Record one-on-one'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => { if (!reportId || !meetingDate) { setError('Direct report and meeting date are required.'); return; } setError(''); save.mutate(); }}>Save meeting</Button></>}>
    {error && <div style={{ marginBottom: 12 }}><Alert type="error">{error}</Alert></div>}
    {usersLoading ? <div style={{ padding: 18, textAlign: 'center' }}><Spinner /></div> : usersError ? <QueryError message={usersError} onRetry={retryUsers} /> : users.length === 0 ? <Alert type="info">No activated editor users are available.</Alert> : <Select label="Direct report" value={reportId} onChange={event => { setReportId(event.target.value); setError(''); }} options={[{ value: '', label: 'Select an editor' }, ...users.map(user => ({ value: user.id, label: `${user.name} (${user.email})` }))]} />}
    <Input label="Meeting date" type="date" max={today} value={meetingDate} onChange={event => { const value = event.target.value; setMeetingDate(value); setNextDate(addDays(value, 14)); setError(''); }} hint="Future dates cannot be used when logging a completed one-on-one." />
    <BulletField label="Wins and progress" value={wins} onChange={setWins} /><BulletField label="Discussion points" value={discussion} onChange={setDiscussion} /><BulletField label="Challenges" value={challenges} onChange={setChallenges} /><BulletField label="Learning & development" value={learning} onChange={setLearning} /><BulletField label="Manager feedback" value={feedback} onChange={setFeedback} />
    <Input label="Presentation-safe summary" value={summary} onChange={event => setSummary(event.target.value)} placeholder="Only content suitable for the leadership review" />
    <label className="label">Private notes</label><textarea className="input" rows={3} value={privateNotes} onChange={event => setPrivateNotes(event.target.value)} />
    <Input label="Next meeting date" type="date" value={nextDate} onChange={event => setNextDate(event.target.value)} hint="Defaults to 14 days after this meeting and can be adjusted." />
  </Modal>;
}

function MeetingDetailModal({ meeting, onClose, onEdit }: { meeting: Meeting; onClose: () => void; onEdit: () => void }) {
  return <Modal open onClose={onClose} title={`One-on-one · ${meeting.report.name}`} footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button variant="primary" onClick={onEdit}>Edit</Button></>}>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18 }}>
      <div><div className="label">Meeting date</div><strong>{new Date(meeting.meetingDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</strong></div>
      <div><div className="label">Next meeting</div><strong>{meeting.nextMeetingDate ? new Date(meeting.nextMeetingDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Not scheduled'}</strong></div>
    </div>
    <MeetingDetailSection title="Wins and progress" items={meeting.wins} />
    <MeetingDetailSection title="Discussion points" items={meeting.discussionPoints} />
    <MeetingDetailSection title="Challenges" items={meeting.challenges} />
    <MeetingDetailSection title="Learning & development" items={meeting.learningDevelopment} />
    <MeetingDetailSection title="Manager feedback" items={meeting.managerFeedback} />
    <MeetingDetailSection title="Actions" items={(meeting.actions ?? []).map(action => [action.action, action.owner, action.dueDate].filter(Boolean).join(' · '))} />
    <MeetingDetailSection title="Presentation-safe summary" items={meeting.presentationSummary ? [meeting.presentationSummary] : []} />
    <MeetingDetailSection title="Private notes" items={meeting.privateNotes ? [meeting.privateNotes] : []} privateSection />
  </Modal>;
}

function MeetingDetailSection({ title, items, privateSection = false }: { title: string; items: string[]; privateSection?: boolean }) {
  return <div style={{ marginBottom: 16, padding: 12, borderRadius: 7, background: privateSection ? 'var(--color-warning-light)' : 'var(--gray-50)' }}><div style={{ fontWeight: 600, marginBottom: 6 }}>{title}{privateSection ? ' · confidential' : ''}</div>{items.length ? <ul style={{ margin: 0, paddingLeft: 20 }}>{items.map((item, index) => <li key={index} style={{ marginBottom: 4 }}>{item}</li>)}</ul> : <span style={{ color: 'var(--gray-400)', fontSize: '0.875rem' }}>Nothing recorded.</span>}</div>;
}

const LEARNING_TYPE_OPTIONS = [
  { value: 'course', label: 'Course' }, { value: 'certification', label: 'Certification' },
  { value: 'workshop', label: 'Workshop' }, { value: 'conference', label: 'Conference' },
  { value: 'mentorship', label: 'Mentorship' },
];
const LEARNING_STATUS_OPTIONS = [
  { value: 'planned', label: 'Planned' }, { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' }, { value: 'paused', label: 'Paused' },
  { value: 'cancelled', label: 'Cancelled' },
];
const displayDate = (value?: string | null) => value ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

function LearningTracker({ users }: { users: Person[] }) {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editRecord, setEditRecord] = useState<LearningRecord | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<LearningRecord | null>(null);
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [error, setError] = useState('');
  const query = useQuery({
    queryKey: ['leadership-learning', employeeFilter, statusFilter, typeFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (employeeFilter) params.set('employeeId', employeeFilter);
      if (statusFilter) params.set('status', statusFilter);
      if (typeFilter) params.set('type', typeFilter);
      const search = params.toString();
      return api.get<{ records: LearningRecord[] }>(`leadership/learning-records${search ? `?${search}` : ''}`);
    },
  });
  const remove = useMutation({
    mutationFn: (recordId: string) => api.delete(`leadership/learning-records/${recordId}`),
    onSuccess: () => { setError(''); setConfirmDelete(null); qc.invalidateQueries({ queryKey: ['leadership-learning'] }); },
    onError: (err: Error) => setError(err.message),
  });
  const records = query.data?.records ?? [];
  const recordGroups = [...records.reduce((groups, record) => {
    const group = groups.get(record.employee.id) ?? { employee: record.employee, records: [] as LearningRecord[] };
    group.records.push(record);
    groups.set(record.employee.id, group);
    return groups;
  }, new Map<string, { employee: Person; records: LearningRecord[] }>()).values()]
    .sort((a, b) => a.employee.name.localeCompare(b.employee.name));
  const now = new Date();
  const inNinetyDays = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  const overdue = records.filter(record => ['planned', 'in_progress'].includes(record.status) && record.targetCompletionDate && new Date(record.targetCompletionDate) < now).length;
  const expiring = records.filter(record => record.expiryDate && new Date(record.expiryDate) >= now && new Date(record.expiryDate) <= inNinetyDays).length;
  const closeForm = () => { setError(''); setShowCreate(false); setEditRecord(null); };
  const saved = () => { closeForm(); qc.invalidateQueries({ queryKey: ['leadership-learning'] }); };

  return <div>
    <div className="grid-4" style={{ marginBottom: 20 }}>
      <StatCard label="In progress" value={records.filter(record => record.status === 'in_progress').length} color="var(--color-primary)" />
      <StatCard label="Completed" value={records.filter(record => record.status === 'completed').length} color="var(--color-success)" />
      <StatCard label="Overdue" value={overdue} color={overdue ? 'var(--color-danger)' : 'var(--gray-500)'} />
      <StatCard label="Expiring in 90 days" value={expiring} color={expiring ? 'var(--color-warning)' : 'var(--gray-500)'} />
    </div>
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <div className="leadership-learning-filter">
        <div style={{ minWidth: 210, flex: 1 }}><Select label="Editor" value={employeeFilter} onChange={event => setEmployeeFilter(event.target.value)} options={[{ value: '', label: 'All editors' }, ...users.map(user => ({ value: user.id, label: user.name }))]} /></div>
        <div style={{ minWidth: 170 }}><Select label="Status" value={statusFilter} onChange={event => setStatusFilter(event.target.value)} options={[{ value: '', label: 'All statuses' }, ...LEARNING_STATUS_OPTIONS]} /></div>
        <div style={{ minWidth: 170 }}><Select label="Type" value={typeFilter} onChange={event => setTypeFilter(event.target.value)} options={[{ value: '', label: 'All types' }, ...LEARNING_TYPE_OPTIONS]} /></div>
        <div className="leadership-learning-actions"><Button variant="primary" onClick={() => { setError(''); setShowCreate(true); }}>+ Add L&D record</Button></div>
      </div>
    </div>
    {error && <div style={{ marginBottom: 16 }}><Alert type="error">{error}</Alert></div>}
    {query.isLoading && <div className="card" style={{ padding: 40, textAlign: 'center' }}><Spinner /></div>}
    {query.isError && <QueryError message={query.error.message} onRetry={() => query.refetch()} />}
    {!query.isLoading && !query.isError && records.length === 0 && <div className="card"><EmptyState icon="◇" title="No L&D records found" description="Track courses, certifications, workshops and other development activities for your editors." action={<Button variant="primary" onClick={() => setShowCreate(true)}>Add first L&D record</Button>} /></div>}
    {!query.isLoading && recordGroups.map(group => <div className="card" key={group.employee.id} style={{ marginBottom: 16, overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '14px 18px', background: 'var(--gray-50)', borderBottom: '1px solid var(--border-color)' }}>
        <div><strong>{group.employee.name}</strong><div style={{ color: 'var(--gray-500)', fontSize: '0.8125rem', marginTop: 3 }}>{group.employee.email}</div></div>
        <span style={{ color: 'var(--gray-500)', fontSize: '0.8125rem' }}>{group.records.length} {group.records.length === 1 ? 'record' : 'records'}</span>
      </div>
      {group.records.map((record, index) => {
        const isOverdue = ['planned', 'in_progress'].includes(record.status) && !!record.targetCompletionDate && new Date(record.targetCompletionDate) < now;
        const isExpiring = !!record.expiryDate && new Date(record.expiryDate) >= now && new Date(record.expiryDate) <= inNinetyDays;
        return <div key={record.id} style={{ padding: '15px 18px', borderBottom: index < group.records.length - 1 ? '1px solid var(--border-color)' : 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 260 }}><div style={{ fontWeight: 600 }}>{record.title}</div><div style={{ color: 'var(--gray-500)', fontSize: '0.8125rem', marginTop: 4 }}>{LEARNING_TYPE_OPTIONS.find(option => option.value === record.type)?.label ?? record.type}{record.provider ? ` · ${record.provider}` : ''}{record.skillArea ? ` · ${record.skillArea}` : ''}</div></div>
            <span style={{ fontSize: '0.75rem', textTransform: 'capitalize', padding: '4px 9px', borderRadius: 12, background: record.status === 'completed' ? 'var(--color-success-light)' : record.status === 'in_progress' ? 'var(--color-info-light)' : 'var(--gray-100)' }}>{record.status.replace('_', ' ')}</span>
            {isOverdue && <span style={{ color: 'var(--color-danger)', fontSize: '0.75rem', fontWeight: 600 }}>Overdue</span>}
            {isExpiring && <span style={{ color: 'var(--color-warning)', fontSize: '0.75rem', fontWeight: 600 }}>Expiring soon</span>}
            <Button variant="secondary" size="sm" onClick={() => { setError(''); setEditRecord(record); }}>Edit</Button>
            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(record)}>Delete</Button>
          </div>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 10, color: 'var(--gray-500)', fontSize: '0.8125rem' }}><span>Start: {displayDate(record.startDate)}</span><span>Target: {displayDate(record.targetCompletionDate)}</span><span>Completed: {displayDate(record.completionDate)}</span>{record.expiryDate && <span>Expires: {displayDate(record.expiryDate)}</span>}<span>{record.learningHours} hour(s)</span>{record.evidenceUrl && <a href={record.evidenceUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)' }}>Evidence ↗</a>}</div>
          {record.notes && <div style={{ marginTop: 10, fontSize: '0.875rem', color: 'var(--gray-600)' }}>{record.notes}</div>}
        </div>;
      })}
    </div>)}
    {(showCreate || editRecord) && <LearningFormModal open users={users} record={editRecord ?? undefined} error={error} setError={setError} onClose={closeForm} onSaved={saved} />}
    <ConfirmDialog open={!!confirmDelete} title="Delete L&D record" message={`Permanently delete “${confirmDelete?.title ?? 'this learning record'}”? This cannot be undone.`} confirmLabel="Delete" onConfirm={() => { if (confirmDelete) remove.mutate(confirmDelete.id); }} onCancel={() => setConfirmDelete(null)} />
  </div>;
}

function LearningFormModal({ open, users, record, error, setError, onClose, onSaved }: { open: boolean; users: Person[]; record?: LearningRecord; error: string; setError: (value: string) => void; onClose: () => void; onSaved: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [employeeId, setEmployeeId] = useState(record?.employee.id ?? ''); const [title, setTitle] = useState(record?.title ?? ''); const [type, setType] = useState(record?.type ?? 'course'); const [provider, setProvider] = useState(record?.provider ?? ''); const [skillArea, setSkillArea] = useState(record?.skillArea ?? ''); const [status, setStatus] = useState(record?.status ?? 'planned'); const [startDate, setStartDate] = useState(record?.startDate?.slice(0, 10) ?? ''); const [targetDate, setTargetDate] = useState(record?.targetCompletionDate?.slice(0, 10) ?? ''); const [completionDate, setCompletionDate] = useState(record?.completionDate?.slice(0, 10) ?? ''); const [expiryDate, setExpiryDate] = useState(record?.expiryDate?.slice(0, 10) ?? ''); const [hours, setHours] = useState(String(record?.learningHours ?? 0)); const [evidenceUrl, setEvidenceUrl] = useState(record?.evidenceUrl ?? ''); const [notes, setNotes] = useState(record?.notes ?? '');
  const save = useMutation({
    mutationFn: () => { const body = { employeeId, title: title.trim(), type, provider: provider.trim() || undefined, skillArea: skillArea.trim() || undefined, status, startDate: startDate || undefined, targetCompletionDate: targetDate || undefined, completionDate: completionDate || undefined, expiryDate: expiryDate || undefined, learningHours: Number(hours) || 0, evidenceUrl: evidenceUrl.trim() || undefined, notes: notes.trim() || undefined }; return record ? api.patch(`leadership/learning-records/${record.id}`, body) : api.post('leadership/learning-records', body); },
    onSuccess: onSaved, onError: (err: Error) => setError(err.message),
  });
  return <Modal open={open} onClose={onClose} title={record ? 'Edit L&D record' : 'Add L&D record'} maxWidth={720} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => { if (!employeeId || !title.trim()) { setError('Editor and title are required.'); return; } setError(''); save.mutate(); }}>Save record</Button></>}>
    {error && <div style={{ marginBottom: 14 }}><Alert type="error">{error}</Alert></div>}
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
      <Select label="Editor" value={employeeId} onChange={event => { setEmployeeId(event.target.value); setError(''); }} options={[{ value: '', label: 'Select an editor' }, ...users.map(user => ({ value: user.id, label: `${user.name} (${user.email})` }))]} />
      <Input label="Title" value={title} onChange={event => { setTitle(event.target.value); setError(''); }} placeholder="e.g. ISTQB Foundation" />
      <Select label="Type" value={type} onChange={event => setType(event.target.value)} options={LEARNING_TYPE_OPTIONS} />
      <Select label="Status" value={status} onChange={event => { const value = event.target.value; setStatus(value); if (value === 'completed' && !completionDate) setCompletionDate(today); }} options={LEARNING_STATUS_OPTIONS} />
      <Input label="Provider" value={provider} onChange={event => setProvider(event.target.value)} placeholder="e.g. ISTQB, Coursera" />
      <Input label="Skill area" value={skillArea} onChange={event => setSkillArea(event.target.value)} placeholder="e.g. Test automation" />
      <Input label="Start date" type="date" value={startDate} onChange={event => setStartDate(event.target.value)} />
      <Input label="Target completion" type="date" value={targetDate} onChange={event => setTargetDate(event.target.value)} />
      <Input label="Completion date" type="date" max={today} value={completionDate} onChange={event => setCompletionDate(event.target.value)} />
      <Input label="Certification expiry / renewal" type="date" value={expiryDate} onChange={event => setExpiryDate(event.target.value)} />
      <Input label="Learning hours" type="number" min="0" step="0.5" value={hours} onChange={event => setHours(event.target.value)} />
      <Input label="Evidence / certificate URL" type="url" value={evidenceUrl} onChange={event => setEvidenceUrl(event.target.value)} placeholder="https://..." />
    </div>
    <label className="label">Progress notes</label><textarea className="input" rows={4} value={notes} onChange={event => setNotes(event.target.value)} style={{ resize: 'vertical' }} />
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
