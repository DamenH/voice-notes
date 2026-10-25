import { useEffect, useId, useRef, useState, useSyncExternalStore, type ButtonHTMLAttributes, type ComponentProps, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';

type Variant = 'primary' | 'secondary' | 'plain' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-text hover:brightness-110 active:brightness-95',
  secondary: 'bg-surface-2 text-text hover:bg-surface-3 border border-hairline',
  plain: 'text-muted hover:text-text hover:bg-surface-2',
  danger: 'bg-rec text-white hover:brightness-110',
};

export function Button({
  variant = 'secondary',
  icon,
  small,
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: IconName; small?: boolean }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition disabled:opacity-50 ${
        small ? 'min-h-8 px-2.5 text-[13px]' : 'min-h-11 px-4 text-sm pointer-fine:min-h-9'
      } ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {icon && <Icon name={icon} size={small ? 16 : 18} />}
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  className = '',
  size = 20,
  ...rest
}: ComponentProps<'button'> & { icon: IconName; label: string; size?: number }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-grid size-11 place-items-center rounded-full text-muted transition hover:bg-surface-2 hover:text-text pointer-fine:size-9 ${className}`}
      {...rest}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

export interface MenuItem {
  label: string;
  icon?: IconName;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** Overflow menu: secondary actions live here instead of as always-visible buttons. */
export function Menu({ items, label = 'More actions', icon = 'more' as IconName, className = '' }: { items: MenuItem[]; label?: string; icon?: IconName; className?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean }>({ top: 0, left: 0, up: false });
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && (setOpen(false), btn.current?.focus());
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', key);
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const toggle = () => {
    const r = btn.current!.getBoundingClientRect();
    const up = r.bottom > window.innerHeight - 260;
    setPos({ top: up ? r.top : r.bottom, left: Math.min(r.right, window.innerWidth - 8), up });
    setOpen((o) => !o);
  };

  return (
    <>
      <IconButton ref={btn} icon={icon} label={label} aria-haspopup="menu" aria-expanded={open} onClick={toggle} className={className} />
      {open &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            className="animate-fade fixed z-50 min-w-48 -translate-x-full overflow-hidden rounded-xl border border-hairline bg-surface py-1 shadow-xl"
            style={{ left: pos.left, ...(pos.up ? { bottom: window.innerHeight - pos.top + 4 } : { top: pos.top + 4 }) }}
          >
            {items.map((it) => (
              <button
                key={it.label}
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
                className={`flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-sm hover:bg-surface-2 focus:bg-surface-2 focus:outline-none disabled:opacity-40 ${
                  it.danger ? 'text-rec' : 'text-text'
                }`}
              >
                {it.icon && <Icon name={it.icon} size={18} className={it.danger ? '' : 'text-muted'} />}
                {it.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

/** Modal on phones (bottom sheet) and a centred dialog on desktop. */
export function Dialog({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const id = useId();
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);
  return createPortal(
    <div className="animate-fade fixed inset-0 z-40 flex items-end justify-center bg-black/40 desk:items-center" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className={`animate-sheet flex max-h-[90dvh] w-full flex-col rounded-t-2xl bg-surface shadow-2xl desk:animate-rise desk:rounded-2xl ${wide ? 'desk:max-w-2xl' : 'desk:max-w-lg'}`}
        style={{ paddingBottom: 'var(--safe-bottom)' }}
      >
        <div className="flex items-center gap-2 border-b border-hairline px-5 py-3">
          <h2 id={id} className="flex-1 text-base font-bold">
            {title}
          </h2>
          <IconButton icon="close" label="Close" onClick={onClose} className="-mr-2" />
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-hairline px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-semibold text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-faint">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'w-full rounded-lg border border-border bg-surface px-3 py-2 text-[15px] text-text placeholder:text-faint focus:border-accent focus:outline-none min-h-11 pointer-fine:min-h-9';

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-1">
      <span className="flex-1">
        <span className="block text-[15px] font-medium">{label}</span>
        {description && <span className="block text-[13px] text-muted">{description}</span>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span
        aria-hidden
        className={`relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition peer-focus-visible:outline-2 peer-focus-visible:outline-accent ${checked ? 'bg-accent' : 'bg-surface-3'}`}
      >
        <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`min-h-9 rounded-md px-3 text-[13px] font-semibold transition pointer-fine:min-h-7 ${
            value === o.value ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Toasts ----------

type Toast = { id: number; message: string; tone: 'info' | 'error' };
let toasts: Toast[] = [];
const toastListeners = new Set<() => void>();
let toastId = 0;

export function toast(message: string, tone: Toast['tone'] = 'info') {
  const t = { id: ++toastId, message, tone };
  toasts = [...toasts, t];
  toastListeners.forEach((fn) => fn());
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    toastListeners.forEach((fn) => fn());
  }, tone === 'error' ? 6000 : 3000);
}

export function Toasts() {
  const list = useSyncExternalStore(
    (fn) => {
      toastListeners.add(fn);
      return () => void toastListeners.delete(fn);
    },
    () => toasts,
  );
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(96px+var(--safe-bottom))] z-50 flex flex-col items-center gap-2 px-4 desk:bottom-6">
      {list.map((t) => (
        <p
          key={t.id}
          className={`animate-rise max-w-md rounded-2xl px-4 py-2.5 text-sm font-semibold shadow-lg ${t.tone === 'error' ? 'bg-rec text-white' : 'bg-text text-bg'}`}
        >
          {t.message}
        </p>
      ))}
    </div>
  );
}

export function confirmAction(message: string) {
  return window.confirm(message);
}
