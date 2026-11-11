import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { Plus, Send, Star, Timer } from 'lucide-react';
import DataTable from '../../components/tables/DataTable.jsx';
import { Card, KV, PageHeader, StatCard, StatusBadge, Tabs } from '../../components/ui/index.jsx';
import { FormModal } from '../../components/forms/EntityForm.jsx';
import { RecordNotFound } from '../../components/layout/Fallbacks.jsx';
import { useAuth } from '../../store/authStore.js';
import { useData } from '../../store/dataStore.js';
import { toast } from '../../store/uiStore.js';
import { useLookups } from '../../hooks/useApp.js';
import { SLA_HOURS } from '../../data/config.js';
import { fmtDate, fmtDateTime } from '../../utils/format.js';

const OPEN_STATES = ['Open', 'In Progress'];
const AGENTS = ['Ayesha Nawaz', 'Maria Yousaf', 'Bilal Ahmed', 'Hina Siddiqui'];

/** Minutes left until SLA breach, negative once breached, null once the ticket is closed out. */
function slaLeft(t, now = Date.now()) {
  if (!OPEN_STATES.includes(t.status)) return null;
  return Math.round((new Date(t.createdAt).getTime() + SLA_HOURS[t.priority] * 3600000 - now) / 60000);
}
const fmtMins = (m) => {
  const abs = Math.abs(m);
  const d = Math.floor(abs / 1440);
  const h = Math.floor((abs % 1440) / 60);
  if (d) return `${d}d ${h}h`;
  return `${h}h ${abs % 60}m`;
};

function SlaBadge({ ticket }) {
  const left = slaLeft(ticket);
  if (left === null) return <span className="text-xs text-ink-muted">-</span>;
  return (
    <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-semibold', left < 0 ? 'bg-danger text-white' : 'bg-gray-100 text-gray-700')}>
      <Timer size={12} aria-hidden /> {left < 0 ? `Breached ${fmtMins(left)}` : `${fmtMins(left)} left`}
    </span>
  );
}

export function TicketList() {
  const navigate = useNavigate();
  const lookups = useLookups();
  const { tickets, shipments, addItem } = useData();
  const [adding, setAdding] = useState(false);
  const open = tickets.filter((t) => OPEN_STATES.includes(t.status));
  const breached = open.filter((t) => slaLeft(t) < 0);
  return (
    <div>
      <PageHeader title="Tickets" subtitle="Customer support, linked to shipments, with SLA timers." actions={<button type="button" className="btn-primary" onClick={() => setAdding(true)}><Plus size={16} aria-hidden /> New ticket</button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Open" value={open.length} />
        <StatCard label="SLA breached" value={breached.length} tone={breached.length ? 'danger' : 'default'} />
        <StatCard label="Resolved" value={tickets.filter((t) => t.status === 'Resolved').length} />
        <StatCard label="Closed" value={tickets.filter((t) => t.status === 'Closed').length} />
      </div>
      <DataTable
        data={tickets}
        exportName="tickets"
        dateKey="createdAt"
        onRowClick={(t) => navigate(`/support/${t.id}`)}
        rowClass={(t) => (slaLeft(t) !== null && slaLeft(t) < 0 ? 'bg-danger-light/40' : '')}
        filters={[
          { key: 'status', label: 'Status', options: ['Open', 'In Progress', 'Resolved', 'Closed'] },
          { key: 'priority', label: 'Priority', options: Object.keys(SLA_HOURS) },
          { key: 'assignee', label: 'Assignee', options: AGENTS },
          { key: 'sla', label: 'SLA', options: ['Breached', 'Within SLA'], match: (t, v) => { const l = slaLeft(t); return l !== null && (v === 'Breached' ? l < 0 : l >= 0); } },
        ]}
        columns={[
          { key: 'id', header: 'Ticket', render: (t) => <Link className="link" onClick={(e) => e.stopPropagation()} to={`/support/${t.id}`}>{t.id}</Link>, value: (t) => t.id },
          { key: 'subject', header: 'Subject', className: 'max-w-[280px] truncate' },
          { key: 'merchant', header: 'Customer', value: (t) => lookups.merchantName(t.merchantId) },
          { key: 'awb', header: 'AWB' },
          { key: 'assignee', header: 'Assignee' },
          { key: 'priority', header: 'Priority', render: (t) => <StatusBadge status={t.priority} />, value: (t) => t.priority },
          { key: 'sla', header: 'SLA', value: (t) => slaLeft(t) ?? 999999, render: (t) => <SlaBadge ticket={t} />, exportValue: (t) => { const l = slaLeft(t); return l === null ? '' : l < 0 ? 'Breached' : 'Within SLA'; } },
          { key: 'status', header: 'Status', render: (t) => <StatusBadge status={t.status} />, value: (t) => t.status },
          { key: 'createdAt', header: 'Opened', render: (t) => fmtDateTime(t.createdAt), exportValue: (t) => fmtDateTime(t.createdAt) },
        ]}
      />
      <FormModal
        open={adding}
        onClose={() => setAdding(false)}
        title="New ticket"
        fields={[
          { name: 'subject', label: 'Subject', required: true, full: true },
          { name: 'awb', label: 'AWB', required: true },
          { name: 'priority', label: 'Priority', type: 'select', options: Object.keys(SLA_HOURS), required: true, default: 'Medium' },
          { name: 'assignee', label: 'Assignee', type: 'select', options: AGENTS, required: true },
          { name: 'message', label: 'Message', type: 'textarea', required: true, full: true },
        ]}
        onSubmit={(v) => {
          const awb = v.awb.trim().toUpperCase();
          const s = shipments.find((x) => x.awb === awb);
          if (!s) { toast.error(`${awb} was not found`); return; }
          const at = new Date().toISOString();
          const id = `TK-${Math.floor(10000 + Math.random() * 89999)}`;
          addItem('tickets', { id, subject: v.subject, awb, shipmentId: s.id, merchantId: s.merchantId, requester: lookups.merchant(s.merchantId)?.contact, priority: v.priority, status: 'Open', assignee: v.assignee, createdAt: at, resolvedAt: null, replies: [{ id: 1, author: 'Support Desk', internal: false, at, text: v.message }] }, 'Ticket', `${id} opened`);
          setAdding(false);
          toast.success(`${id} created`);
          navigate(`/support/${id}`);
        }}
      />
    </div>
  );
}

export function TicketDetail() {
  const { id } = useParams();
  const { pathname } = useLocation();
  const user = useAuth((s) => s.user);
  const lookups = useLookups();
  const { tickets, cannedResponses, updateItem } = useData();
  const [text, setText] = useState('');
  const [internal, setInternal] = useState(false);
  const [, tick] = useState(0);
  // Keep the SLA countdown live while the page is open.
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 60000); return () => clearInterval(t); }, []);
  const t = tickets.find((x) => x.id === id);
  const portal = pathname.startsWith('/portal');
  const isMerchant = user.role === 'merchant';
  const backTo = portal ? '/portal/tickets' : '/support';
  if (!t || (isMerchant && t.merchantId !== user.merchantId)) return <RecordNotFound what="Ticket" backTo={backTo} backLabel="Back to tickets" />;
  const staff = !portal && !isMerchant;
  const replies = t.replies.filter((r) => staff || !r.internal);
  const closed = t.status === 'Closed';

  const send = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    const isInternal = staff && internal;
    updateItem('tickets', id, (x) => ({
      replies: [...x.replies, { id: x.replies.length + 1, author: user.name, internal: isInternal, at: new Date().toISOString(), text: text.trim() }],
      // A staff reply moves a new ticket forward; a customer reply re-opens a resolved one.
      status: !isInternal && staff && x.status === 'Open' ? 'In Progress' : !staff && x.status === 'Resolved' ? 'Open' : x.status,
    }), 'Ticket', `${id}: reply added`);
    setText('');
    setInternal(false);
    toast.success(isInternal ? 'Internal note added' : 'Reply sent');
  };
  const setStatus = (status) => {
    updateItem('tickets', id, { status, resolvedAt: ['Resolved', 'Closed'].includes(status) ? new Date().toISOString() : null }, 'Ticket', `${id} -> ${status}`);
    toast.success(`Ticket ${status.toLowerCase()}`);
  };

  return (
    <div>
      <PageHeader title={t.subject} subtitle={`${t.id} - opened ${fmtDateTime(t.createdAt)}`} actions={<><StatusBadge status={t.priority} /><StatusBadge status={t.status} /><SlaBadge ticket={t} /></>} />
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card title="Conversation" className="lg:col-span-2">
          <ul className="mb-4 space-y-3">
            {replies.map((r) => (
              <li key={r.id} className={clsx('rounded-lg border p-3 text-sm', r.internal ? 'border-primary bg-primary-light' : 'border-line')}>
                <p className="mb-1 flex flex-wrap justify-between gap-2 text-xs"><b>{r.author}{r.internal && ' (internal note)'}</b><span className="text-ink-muted">{fmtDateTime(r.at)}</span></p>
                <p className="whitespace-pre-wrap">{r.text}</p>
              </li>
            ))}
          </ul>
          {closed ? <p className="text-sm text-ink-muted">This ticket is closed.</p> : (
            <form onSubmit={send} className="space-y-2">
              {staff && (
                <select aria-label="Canned response" className="input" value="" onChange={(e) => { const c = cannedResponses.find((x) => x.id === e.target.value); if (c) setText(c.text); }}>
                  <option value="">Insert a canned response...</option>
                  {cannedResponses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              )}
              <textarea aria-label="Reply" rows={3} className="input" placeholder="Write a reply..." value={text} onChange={(e) => setText(e.target.value)} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                {staff ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-primary-hover" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note</label> : <span />}
                <button type="submit" className="btn-primary" disabled={!text.trim()}><Send size={15} aria-hidden /> Send</button>
              </div>
            </form>
          )}
        </Card>
        <Card title="Details">
          <dl className="grid gap-3">
            <KV label="Customer">{lookups.merchantName(t.merchantId)}</KV>
            <KV label="Requester">{t.requester}</KV>
            <KV label="Shipment">{t.shipmentId ? <Link className="link" to={`/shipments/${t.shipmentId}`}>{t.awb}</Link> : 'None'}</KV>
            <KV label="SLA target">{SLA_HOURS[t.priority]} hours</KV>
            {t.resolvedAt && <KV label="Resolved">{fmtDateTime(t.resolvedAt)}</KV>}
          </dl>
          {staff && (
            <div className="mt-4 space-y-3 border-t border-line pt-3">
              <div><label htmlFor="tp" className="label">Priority</label><select id="tp" className="input" value={t.priority} onChange={(e) => { updateItem('tickets', id, { priority: e.target.value }, 'Ticket', `${id} priority ${e.target.value}`); toast.success('Priority updated'); }}>{Object.keys(SLA_HOURS).map((p) => <option key={p}>{p}</option>)}</select></div>
              <div><label htmlFor="ta" className="label">Assignee</label><select id="ta" className="input" value={t.assignee} onChange={(e) => { updateItem('tickets', id, { assignee: e.target.value }, 'Ticket', `${id} assigned to ${e.target.value}`); toast.success('Assignee updated'); }}>{!AGENTS.includes(t.assignee) && <option>{t.assignee}</option>}{AGENTS.map((a) => <option key={a}>{a}</option>)}</select></div>
              <div><label htmlFor="ts" className="label">Status</label><select id="ts" className="input" value={t.status} onChange={(e) => setStatus(e.target.value)}>{['Open', 'In Progress', 'Resolved', 'Closed'].map((s) => <option key={s}>{s}</option>)}</select></div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

export function FeedbackList() {
  const { feedback, shipments, addItem, updateItem } = useData();
  const [tab, setTab] = useState('all');
  const [adding, setAdding] = useState(false);
  const rows = tab === 'all' ? feedback : feedback.filter((f) => f.type === tab);
  const avg = feedback.length ? (feedback.reduce((a, f) => a + f.rating, 0) / feedback.length).toFixed(1) : '-';
  return (
    <div>
      <PageHeader title="Feedback" subtitle="Complaints and customer feedback." actions={<button type="button" className="btn-primary" onClick={() => setAdding(true)}><Plus size={16} aria-hidden /> Log entry</button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Average rating" value={`${avg} / 5`} icon={Star} />
        <StatCard label="Open complaints" value={feedback.filter((f) => f.type === 'Complaint' && OPEN_STATES.includes(f.status)).length} tone="danger" />
        <StatCard label="Entries" value={feedback.length} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'all', label: 'All' }, { value: 'Complaint', label: 'Complaints' }, { value: 'Feedback', label: 'Feedback' }]} />
      <DataTable
        data={rows}
        exportName="feedback"
        dateKey="date"
        columns={[
          { key: 'id', header: 'ID' },
          { key: 'type', header: 'Type' },
          { key: 'awb', header: 'AWB' },
          { key: 'customer', header: 'Customer' },
          { key: 'rating', header: 'Rating', render: (f) => <span className={clsx('font-semibold', f.rating <= 2 && 'text-danger')} aria-label={`${f.rating} of 5`}>{f.rating} / 5</span> },
          { key: 'comment', header: 'Comment', className: 'max-w-[320px] truncate' },
          { key: 'date', header: 'Date', render: (f) => fmtDate(f.date), exportValue: (f) => fmtDate(f.date) },
          { key: 'status', header: 'Status', render: (f) => <StatusBadge status={f.status} />, value: (f) => f.status },
          { key: 'act', header: '', sortable: false, export: false, render: (f) => f.type === 'Complaint' && OPEN_STATES.includes(f.status) && <button type="button" className="btn-outline btn-sm" onClick={() => { updateItem('feedback', f.id, { status: 'Resolved' }, 'Feedback', `${f.id} resolved`); toast.success('Complaint resolved'); }}>Resolve</button> },
        ]}
      />
      <FormModal
        open={adding}
        onClose={() => setAdding(false)}
        title="Log complaint or feedback"
        fields={[
          { name: 'type', label: 'Type', type: 'select', options: ['Complaint', 'Feedback'], required: true },
          { name: 'awb', label: 'AWB', required: true },
          { name: 'rating', label: 'Rating (1-5)', type: 'number', required: true, min: 1, max: 5 },
          { name: 'customer', label: 'Customer', required: true },
          { name: 'comment', label: 'Comment', type: 'textarea', required: true, full: true },
        ]}
        onSubmit={(v) => {
          const awb = v.awb.trim().toUpperCase();
          if (!shipments.some((s) => s.awb === awb)) { toast.error(`${awb} was not found`); return; }
          addItem('feedback', { id: `FB-${Math.floor(1000 + Math.random() * 9000)}`, ...v, awb, status: v.type === 'Complaint' ? 'Open' : 'Closed', date: new Date().toISOString() }, 'Feedback', `${v.type} logged`);
          setAdding(false);
          toast.success('Entry logged');
        }}
      />
    </div>
  );
}
