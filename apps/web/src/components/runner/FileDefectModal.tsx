import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Input, Modal, Select } from '../shared/ui';
import { api } from '../../lib/api';
import { AttachmentUploader, type AttachmentItem } from './AttachmentUploader';

interface FileDefectModalProps {
  open: boolean;
  projectId: string;
  resultId: number | null;
  defaultTitle: string;
  defaultEnvironment: string;
  onClose: () => void;
  onFiled: () => void;
}

export function detectedEnvironmentFromRun(env?: string) {
  const value = (env ?? '').toLowerCase();
  if (value.includes('prod')) return 'production';
  if (value.includes('stag') || value.includes('uat')) return 'staging';
  if (value.includes('dev') || value.includes('local')) return 'development';
  return 'testing';
}

export function FileDefectModal({
  open, projectId, resultId, defaultTitle, defaultEnvironment, onClose, onFiled,
}: FileDefectModalProps) {
  const [title, setTitle] = useState(defaultTitle);
  const [tracker, setTracker] = useState('jira');
  const [severity, setSeverity] = useState('medium');
  const [environment, setEnvironment] = useState(defaultEnvironment);
  const [externalRef, setExternalRef] = useState('');
  const [notes, setNotes] = useState('');
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [error, setError] = useState('');
  const requestId = useRef(crypto.randomUUID());

  useEffect(() => {
    if (!open) return;
    setTitle(defaultTitle);
    setTracker('jira');
    setSeverity('medium');
    setEnvironment(defaultEnvironment);
    setExternalRef('');
    setNotes('');
    setAttachments([]);
    setError('');
    requestId.current = crypto.randomUUID();
  }, [open, resultId, defaultTitle, defaultEnvironment]);

  const submit = useMutation({
    mutationFn: () => {
      if (resultId === null) throw new Error('The failed result is still being saved. Please try again.');
      return api.post(`projects/${projectId}/results/${resultId}/defect`, {
        clientRequestId: requestId.current,
        title: title.trim(), tracker, severity,
        detectedEnvironment: environment,
        externalRef: externalRef.trim() || undefined,
        notes: notes.trim() || undefined,
        attachments,
      });
    },
    onSuccess: () => { onFiled(); onClose(); },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="File defect from failed test"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={submit.isPending} disabled={submit.isPending} onClick={() => {
          setError('');
          if (!title.trim()) { setError('Title is required'); return; }
          submit.mutate();
        }}>File defect</Button>
      </>}
    >
      {error && <div style={{ marginBottom: 12 }}><Alert type="error">{error}</Alert></div>}
      <Input label="Title" value={title} onChange={event => setTitle(event.target.value)} placeholder="Brief description of the defect" autoFocus />
      <Select label="Severity" value={severity} onChange={event => setSeverity(event.target.value)} options={[
        { value: 'critical', label: 'Critical' }, { value: 'high', label: 'High' },
        { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' },
      ]} />
      <Select label="Tracker" value={tracker} onChange={event => setTracker(event.target.value)} options={[
        { value: 'jira', label: 'Jira' }, { value: 'github', label: 'GitHub' },
        { value: 'linear', label: 'Linear' }, { value: 'internal', label: 'Internal (no external tracker)' },
      ]} />
      <Select label="Detected environment" value={environment} onChange={event => setEnvironment(event.target.value)} options={[
        { value: 'development', label: 'Development' }, { value: 'testing', label: 'QA/Test' },
        { value: 'staging', label: 'UAT/Staging' }, { value: 'production', label: 'Production' },
      ]} />
      <Input label="Ticket URL (optional)" value={externalRef} onChange={event => setExternalRef(event.target.value)} placeholder="https://yourcompany.atlassian.net/browse/PROJ-123" />
      <Input label="Notes (optional)" value={notes} onChange={event => setNotes(event.target.value)} placeholder="Steps to reproduce, actual result, or context" />
      <AttachmentUploader value={attachments} onChange={setAttachments} />
    </Modal>
  );
}
