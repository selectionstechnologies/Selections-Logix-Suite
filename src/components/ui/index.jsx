// Reusable primitives: StatCard, StatusBadge, Modal, Drawer, Stepper, Timeline, Tabs,
// EmptyState, ConfirmHost, ToastHost, FileDropzone, DateRangePicker, skeletons, page header.
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { AlertTriangle, Check, CheckCircle2, Info, Inbox, UploadCloud, X, XCircle } from 'lucide-react';
import { subDays } from 'date-fns';
import { useConfirmStore, useToasts, toast } from '../../store/uiStore.js';
import { statusTone } from '../../utils/status.js';
import { fmtDateTime, isoDay } from '../../utils/format.js';
import { useT } from '../../hooks/useApp.js';

export function StatusBadge({ status, className }) {
  const t = useT();
  return (
    <span className={clsx('inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium', statusTone(status), className)}>
      {t(status)}
    </span>
  );
}

export function StatCard({ label, value, hint, icon: Icon, tone = 'default', onClick }) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp onClick={onClick} className={clsx('card block w-full p-4 text-start', onClick && 'transition hover:border-primary-hover')}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-ink-muted">{label}</p>
        {Icon && (
          <span className={clsx('rounded-lg p-1.5', tone === 'danger' ? 'bg-danger-light text-danger' : 'bg-primary-light text-primary-dark')}>
            <Icon size={16} aria-hidden />
          </span>
        )}
      </div>
      <p className={clsx('mt-1 whitespace-nowrap text-xl font-bold tracking-tight', tone === 'danger' && 'text-danger')}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>}
    </Comp>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-bold">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-muted"><bdi>{subtitle}</bdi></p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, bodyClass = 'p-4' }) {
  return (
    <section className={clsx('card', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function KV({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-medium">{children || '-'}</dd>
    </div>
  );
}

export function Skeleton({ className }) {
  return <div className={clsx('animate-pulse rounded-md bg-gray-200', className)} />;
}

export function PageSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      <Skeleton className="h-7 w-56" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title = 'Nothing here yet', message, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
      <span className="mb-3 rounded-full bg-primary-light p-3 text-primary-dark"><Icon size={22} aria-hidden /></span>
      <p className="font-medium">{title}</p>
      {message && <p className="mt-1 max-w-sm text-sm text-ink-muted">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Keeps Tab inside an open dialog, closes on Escape and restores focus afterwards. */
function useDialog(open, onClose) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const node = ref.current;
    const focusable = () => [...node.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((el) => !el.disabled && el.offsetParent !== null);
    (focusable().find((el) => el.dataset.autofocus !== undefined || ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) || node).focus();
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current?.();
      } else if (e.key === 'Tab') {
        const items = focusable();
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    node.addEventListener('keydown', onKey);
    return () => {
      node.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open]);
  return ref;
}

const SIZES = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' };

export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  const ref = useDialog(open, onClose);
  const titleId = useId();
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className={clsx('flex max-h-[92vh] w-full flex-col rounded-t-xl bg-white shadow-pop outline-none sm:rounded-xl', SIZES[size])}>
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 id={titleId} className="text-base font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="btn-ghost btn-sm" aria-label="Close"><X size={16} /></button>
        </header>
        <div className="scroll-thin flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ open, onClose, title, children, footer, width = 'max-w-md' }) {
  const ref = useDialog(open, onClose);
  const titleId = useId();
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className={clsx('flex h-full w-full flex-col bg-white shadow-pop outline-none', width)}>
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 id={titleId} className="text-base font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="btn-ghost btn-sm" aria-label="Close"><X size={16} /></button>
        </header>
        <div className="scroll-thin flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmHost() {
  const { request, close } = useConfirmStore();
  const finish = (value) => {
    request?.resolve(value);
    close();
  };
  return (
    <Modal
      open={!!request}
      onClose={() => finish(false)}
      title={request?.title || 'Are you sure?'}
      size="sm"
      footer={(
        <>
          <button type="button" className="btn-outline" onClick={() => finish(false)}>Cancel</button>
          <button type="button" data-autofocus className={request?.danger ? 'btn-danger' : 'btn-primary'} onClick={() => finish(true)}>{request?.confirmLabel}</button>
        </>
      )}
    >
      <div className="flex gap-3">
        {request?.danger && <span className="h-fit rounded-full bg-danger-light p-2 text-danger"><AlertTriangle size={18} aria-hidden /></span>}
        <p className="text-sm text-gray-700">{request?.message}</p>
      </div>
    </Modal>
  );
}

const TOAST_STYLE = {
  success: { icon: CheckCircle2, cls: 'border-primary bg-primary-light text-ink' },
  error: { icon: XCircle, cls: 'border-danger bg-danger-light text-danger-dark' },
  info: { icon: Info, cls: 'border-line bg-white text-ink' },
};

export function ToastHost() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed bottom-4 end-4 z-[60] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((t) => {
        const { icon: Icon, cls } = TOAST_STYLE[t.type];
        return (
          <div key={t.id} className={clsx('pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-pop', cls)}>
            <Icon size={18} className="mt-0.5 shrink-0" aria-hidden />
            <p className="flex-1">{t.message}</p>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss"><X size={14} /></button>
          </div>
        );
      })}
    </div>
  );
}

export function Tabs({ tabs, value, onChange, className }) {
  const onKey = (e, i) => {
    if (!['ArrowRight', 'ArrowLeft'].includes(e.key)) return;
    e.preventDefault();
    const next = (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    onChange(tabs[next].value);
    e.currentTarget.parentElement.children[next]?.focus();
  };
  return (
    <div role="tablist" className={clsx('scroll-thin mb-4 flex gap-1 overflow-x-auto border-b border-line', className)}>
      {tabs.map((tab, i) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          tabIndex={value === tab.value ? 0 : -1}
          onKeyDown={(e) => onKey(e, i)}
          onClick={() => onChange(tab.value)}
          className={clsx('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors', value === tab.value ? 'border-primary-hover text-ink' : 'border-transparent text-ink-muted hover:text-ink')}
        >
          {tab.label}
          {tab.count !== undefined && <span className="ms-1.5 rounded-full bg-gray-100 px-1.5 text-xs">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Stepper({ steps, current, onStepClick, failed }) {
  return (
    <ol className="scroll-thin flex items-center gap-1 overflow-x-auto pb-1">
      {steps.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={step} className="flex flex-1 items-center gap-1 last:flex-none">
            <button
              type="button"
              disabled={!onStepClick || i > current}
              onClick={() => onStepClick?.(i)}
              aria-current={active ? 'step' : undefined}
              className="flex items-center gap-2 disabled:cursor-default"
            >
              <span className={clsx(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold',
                done && 'border-primary bg-primary text-ink',
                active && !failed && 'border-primary-hover bg-white text-ink',
                active && failed && 'border-danger bg-danger-light text-danger-dark',
                !done && !active && 'border-line bg-white text-ink-muted',
              )}
              >
                {done ? <Check size={14} aria-hidden /> : i + 1}
              </span>
              <span className={clsx('whitespace-nowrap text-xs font-medium', active ? 'text-ink' : 'text-ink-muted')}>{step}</span>
            </button>
            {i < steps.length - 1 && <span className={clsx('mx-1 h-0.5 min-w-4 flex-1', done ? 'bg-primary' : 'bg-line')} />}
          </li>
        );
      })}
    </ol>
  );
}

const BAD_EVENTS = ['Failed Attempt', 'Return to Origin', 'Returned', 'Cancelled'];

export function Timeline({ events }) {
  const t = useT();
  const ordered = [...events].reverse();
  return (
    <ol className="relative">
      {ordered.map((e, i) => {
        const bad = BAD_EVENTS.includes(e.status);
        return (
          <li key={`${e.status}-${e.at}-${i}`} className="relative flex gap-3 pb-5 last:pb-0">
            {i < ordered.length - 1 && <span className="absolute start-[9px] top-5 h-full w-0.5 bg-line" aria-hidden />}
            <span className={clsx('relative mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full', bad ? 'bg-danger text-white' : i === 0 ? 'bg-primary text-ink' : 'bg-primary-light text-primary-dark')}>
              {bad ? <X size={12} aria-hidden /> : <Check size={12} aria-hidden />}
            </span>
            <div className="min-w-0">
              <p className={clsx('text-sm font-semibold', bad && 'text-danger-dark')}>{t(e.status)}</p>
              {e.note && <p className="text-sm text-gray-700">{e.note}</p>}
              <p className="text-xs text-ink-muted">{fmtDateTime(e.at)}{e.location ? ` - ${e.location}` : ''}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function FileDropzone({ onFiles, accept, multiple = false, hint = 'Drag and drop, or click to browse', compact }) {
  const [drag, setDrag] = useState(false);
  const input = useRef(null);
  const handle = (fileList) => {
    const files = [...fileList];
    if (!files.length) return;
    const allowed = accept?.split(',').map((a) => a.trim().toLowerCase());
    const bad = allowed && files.find((f) => !allowed.some((a) => (a.endsWith('/*') ? f.type.startsWith(a.slice(0, -1)) : f.name.toLowerCase().endsWith(a) || f.type === a)));
    if (bad) {
      toast.error(`${bad.name} is not an accepted file type (${accept})`);
      return;
    }
    onFiles(files);
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click(); } }}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); handle(e.dataTransfer.files); }}
      className={clsx('flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed text-center transition-colors', compact ? 'p-4' : 'p-8', drag ? 'border-primary-hover bg-primary-light' : 'border-line hover:bg-surface')}
    >
      <UploadCloud size={compact ? 20 : 28} className="mb-2 text-ink-muted" aria-hidden />
      <p className="text-sm font-medium">{hint}</p>
      {accept && <p className="mt-0.5 text-xs text-ink-muted">Accepted: {accept}</p>}
      <input ref={input} type="file" hidden accept={accept} multiple={multiple} onChange={(e) => { handle(e.target.files); e.target.value = ''; }} />
    </div>
  );
}

const PRESETS = [['7D', 7], ['30D', 30], ['90D', 90]];

/** value: { from: 'yyyy-MM-dd' | '', to: 'yyyy-MM-dd' | '' } */
export function DateRangePicker({ value, onChange }) {
  const pick = (days) => onChange({ from: isoDay(subDays(new Date(), days)), to: isoDay(new Date()) });
  const invalid = value.from && value.to && value.from > value.to;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <input type="date" aria-label="From date" className={clsx('input !w-auto !py-1.5', invalid && 'input-error')} value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} />
      <span className="text-xs text-ink-muted">to</span>
      <input type="date" aria-label="To date" className={clsx('input !w-auto !py-1.5', invalid && 'input-error')} value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} />
      {PRESETS.map(([label, days]) => (
        <button key={label} type="button" className="btn-outline btn-sm" onClick={() => pick(days)}>{label}</button>
      ))}
      {(value.from || value.to) && <button type="button" className="btn-ghost btn-sm" onClick={() => onChange({ from: '', to: '' })}>Clear</button>}
    </div>
  );
}

/** True when an ISO date falls in a {from,to} day range (inclusive). */
export const inRange = (iso, { from, to }) => {
  const day = isoDay(iso);
  return (!from || day >= from) && (!to || day <= to);
};

export function Toggle({ checked, onChange, label, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className={clsx('relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50', checked ? 'bg-primary-hover' : 'bg-gray-300')}>
      <span className={clsx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', checked ? 'start-[18px]' : 'start-0.5')} />
    </button>
  );
}
