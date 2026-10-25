import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

/** A heading you can click to rename. Enter or leaving the field saves; Escape cancels. */
export function EditableTitle({ value, onSave, className = '', label }: { value: string; onSave: (v: string) => void; className?: string; label: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  const commit = () => {
    const v = draft.trim();
    setEditing(false);
    if (v && v !== value) onSave(v);
  };
  if (editing) {
    return (
      <input
        ref={input}
        aria-label={label}
        value={draft}
        maxLength={120}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
        }}
        className={`w-full min-w-0 rounded-md border border-accent bg-surface px-1.5 font-bold outline-none ${className}`}
      />
    );
  }
  return (
    <h1 className={`min-w-0 ${className}`}>
      <button
        type="button"
        title="Rename"
        aria-label={`${value} — rename`}
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        className="group flex max-w-full items-center gap-1.5 rounded-md px-1.5 text-left font-bold hover:bg-surface-2"
      >
        <span className="truncate">{value}</span>
        <Icon name="pencil" size={14} className="text-faint opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100" />
      </button>
    </h1>
  );
}
