import React, { useState } from 'react';

// ── Button ────────────────────────────────────────────────────
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  full?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  full = false,
  children,
  disabled,
  className = '',
  ...props
}: ButtonProps) {
  const classes = [
    'btn',
    `btn-${variant}`,
    size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : '',
    full ? 'btn-full' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <button className={classes} disabled={disabled || loading} {...props}>
      {loading && <span className="spinner spinner-sm" />}
      {children}
    </button>
  );
}

// ── Input ─────────────────────────────────────────────────────
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export function Input({ label, error, hint, id, className = '', ...props }: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="field">
      {label && <label className="label" htmlFor={inputId}>{label}</label>}
      <input
        id={inputId}
        className={`input ${error ? 'error' : ''} ${className}`}
        {...props}
      />
      {error && <div className="field-error">{error}</div>}
      {hint && !error && <div className="field-hint">{hint}</div>}
    </div>
  );
}

// ── Textarea ──────────────────────────────────────────────────
interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export function Textarea({ label, error, hint, id, className = '', ...props }: TextareaProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="field">
      {label && <label className="label" htmlFor={inputId}>{label}</label>}
      <textarea
        id={inputId}
        className={`input ${error ? 'error' : ''} ${className}`}
        style={{ resize: 'vertical', minHeight: 80 }}
        {...props}
      />
      {error && <div className="field-error">{error}</div>}
      {hint && !error && <div className="field-hint">{hint}</div>}
    </div>
  );
}

// ── Select ────────────────────────────────────────────────────
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: Array<{ value: string; label: string }>;
}

export function Select({ label, error, options, id, className = '', ...props }: SelectProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="field">
      {label && <label className="label" htmlFor={inputId}>{label}</label>}
      <select id={inputId} className={`input ${error ? 'error' : ''} ${className}`} {...props}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}

// ── Spinner ───────────────────────────────────────────────────
export function Spinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`spinner ${size === 'sm' ? 'spinner-sm' : size === 'lg' ? 'spinner-lg' : ''}`} />;
}

export function PageSpinner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <Spinner size="lg" />
    </div>
  );
}

// ── Alert ─────────────────────────────────────────────────────
interface AlertProps {
  type?: 'error' | 'success' | 'info';
  children: React.ReactNode;
}

export function Alert({ type = 'info', children }: AlertProps) {
  const icon = type === 'error' ? '⚠' : type === 'success' ? '✓' : 'ℹ';
  return (
    <div className={`alert alert-${type}`}>
      <span>{icon}</span>
      <span>{children}</span>
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────
interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: number;
}

export function Modal({ open, onClose, title, children, footer, maxWidth = 480 }: ModalProps) {
  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ maxWidth }}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>{title}</h3>
          <button
            onClick={onClose}
            className="btn btn-ghost btn-sm"
            style={{ padding: '4px 8px', fontSize: '1.2rem', lineHeight: 1 }}
          >
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

// ── Badge ─────────────────────────────────────────────────────
export function Badge({ label, type }: { label: string; type: string }) {
  return <span className={`badge badge-${type}`}>{label}</span>;
}

// ── Empty state ───────────────────────────────────────────────
interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon = '📭', title, description, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <div className="empty-state-title">{title}</div>
      {description && <p className="empty-state-desc">{description}</p>}
      {action}
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────
export function StatCard({
  label, value, sub, color,
}: {
  label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={color ? { color } : {}}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

// ── Tag input ─────────────────────────────────────────────────
interface TagInputProps {
  label?: string;
  tags: string[];
  onChange: (tags: string[]) => void;
}

export function TagInput({ label, tags, onChange }: TagInputProps) {
  const [input, setInput] = useState('');

  function addTag(value: string) {
    const trimmed = value.replace(',', '').trim();
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed]);
    }
    setInput('');
  }

  function removeTag(index: number) {
    onChange(tags.filter((_, i) => i !== index));
  }

  return (
    <div className="field">
      {label && <label className="label">{label}</label>}
      <div
        style={{
          display: 'flex', flexWrap: 'wrap', gap: 6,
          padding: '6px 10px', border: '1px solid var(--border-color)',
          borderRadius: 'var(--border-radius-md)', background: 'var(--surface-base)',
          cursor: 'text', minHeight: 40, alignItems: 'center',
        }}
        onClick={() => document.getElementById('tag-input-field')?.focus()}
      >
        {tags.map((tag, i) => (
          <span
            key={i}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '2px 8px', background: 'var(--gray-100)',
              borderRadius: 20, fontSize: '0.8125rem', color: 'var(--gray-700)',
            }}
          >
            {tag}
            <button
              onClick={() => removeTag(i)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-400)', fontSize: '1rem', lineHeight: 1 }}
            >×</button>
          </span>
        ))}
        <input
          id="tag-input-field"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(input); }
            if (e.key === 'Backspace' && !input && tags.length) removeTag(tags.length - 1);
          }}
          placeholder={tags.length === 0 ? 'Add tags…' : ''}
          style={{ border: 'none', outline: 'none', fontSize: '0.875rem', minWidth: 80, background: 'transparent', color: 'var(--gray-900)' }}
        />
      </div>
      <div className="field-hint">Press Enter or comma to add a tag</div>
    </div>
  );
}
