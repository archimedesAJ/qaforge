import { useRef, useState, useEffect } from 'react';
import { api } from '../../lib/api';

export interface AttachmentItem {
  name: string;
  type: 'screenshot' | 'video' | 'log' | 'file';
  url: string;
}

interface Props {
  value: AttachmentItem[];
  onChange: (items: AttachmentItem[]) => void;
}

function detectType(file: File): AttachmentItem['type'] {
  if (file.type.startsWith('image/')) return 'screenshot';
  if (file.type.startsWith('video/')) return 'video';
  if (
    file.type.startsWith('text/') ||
    file.name.endsWith('.log') ||
    file.name.endsWith('.json') ||
    file.name.endsWith('.xml')
  ) return 'log';
  return 'file';
}

const TYPE_ICON: Record<AttachmentItem['type'], string> = {
  screenshot: '🖼',
  video:      '🎬',
  log:        '📄',
  file:       '📎',
};

export function AttachmentUploader({ value, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  async function handleFiles(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    setError('');

    const added: AttachmentItem[] = [];
    try {
      for (const file of files) {
        const form = new FormData();
        form.append('file', file);
        const res = await api.upload<{ url: string }>('uploads', form);
        added.push({ name: file.name, type: detectType(file), url: res.url });
      }
      onChange([...value, ...added]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;

      const items = Array.from(e.clipboardData?.items ?? []);
      const imageFiles = items
        .filter(item => item.type.startsWith('image/'))
        .map(item => {
          const f = item.getAsFile();
          if (!f) return null;
          const ext = f.type.split('/')[1] ?? 'png';
          return new File([f], `screenshot-${Date.now()}.${ext}`, { type: f.type });
        })
        .filter((f): f is File => f !== null);

      if (imageFiles.length === 0) return;
      e.preventDefault();
      handleFiles(imageFiles);
    }

    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, onChange]);

  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--gray-600)' }}>
          Evidence attachments
        </span>
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          style={{
            fontSize: '0.8125rem', padding: '4px 10px', borderRadius: 6,
            border: '1px solid var(--border-color)',
            background: 'var(--surface-base)',
            color: uploading ? 'var(--gray-400)' : 'var(--color-primary)',
            cursor: uploading ? 'not-allowed' : 'pointer',
          }}
        >
          {uploading ? 'Uploading…' : '+ Add files'}
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,video/*,.log,.txt,.json,.xml,.pdf"
        style={{ display: 'none' }}
        onChange={e => handleFiles(Array.from(e.target.files ?? []))}
      />

      {error && (
        <div style={{ fontSize: '0.8125rem', color: 'var(--color-danger)', marginBottom: 6 }}>
          {error}
        </div>
      )}

      {value.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {value.map((item, idx) => (
            <div key={idx} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 10px', borderRadius: 6,
              border: '1px solid var(--border-color)',
              background: 'var(--gray-50)',
            }}>
              {item.type === 'screenshot' ? (
                <img
                  src={item.url}
                  alt={item.name}
                  style={{ width: 44, height: 30, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }}
                  onError={e => { (e.currentTarget as HTMLElement).style.display = 'none'; }}
                />
              ) : (
                <span style={{ fontSize: '1.125rem', flexShrink: 0 }}>{TYPE_ICON[item.type]}</span>
              )}
              <span style={{
                flex: 1, fontSize: '0.8125rem', color: 'var(--gray-700)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {item.name}
              </span>
              <button
                type="button"
                onClick={() => remove(idx)}
                title="Remove"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--gray-400)', fontSize: '1.125rem', padding: '0 2px', lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-primary)'; }}
          onDragLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-color)'; }}
          onDrop={e => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-color)';
            handleFiles(Array.from(e.dataTransfer.files));
          }}
          style={{
            padding: '14px', textAlign: 'center',
            border: '1.5px dashed var(--border-color)', borderRadius: 6,
            cursor: 'pointer', color: 'var(--gray-400)', fontSize: '0.8125rem',
            transition: 'border-color 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-primary)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-color)'}
        >
          Drag &amp; drop, click, or paste (Ctrl+V) to attach screenshots, videos, or logs
        </div>
      )}
    </div>
  );
}
