import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { AlertTriangle, Bell, Info, Pencil, RotateCw, Send } from 'lucide-react';
import DataTable from '../../components/tables/DataTable.jsx';
import { Card, EmptyState, Modal, PageHeader, Tabs, Toggle } from '../../components/ui/index.jsx';
import { useData } from '../../store/dataStore.js';
import { toast } from '../../store/uiStore.js';
import { useCan } from '../../hooks/useApp.js';
import { CHANNELS, TEMPLATE_VARS } from '../../data/config.js';
import { fillTemplate, fmtDateTime, fmtTimeAgo, uid } from '../../utils/format.js';

export function NotificationCenter() {
  const { notifications, updateItem, setValue } = useData();
  const can = useCan();
  const [tab, setTab] = useState('all');
  const unread = notifications.filter((n) => !n.read);
  const rows = tab === 'unread' ? unread : tab === 'alert' ? notifications.filter((n) => n.type === 'alert') : notifications;
  const reachable = (n) => {
    const seg = n.link?.split('/')[1];
    return seg && can(seg);
  };
  return (
    <div>
      <PageHeader title="Notifications" actions={<button type="button" className="btn-outline" disabled={!unread.length} onClick={() => { setValue('notifications', notifications.map((n) => ({ ...n, read: true })), 'Notification', 'Marked all read'); toast.success('All marked as read'); }}>Mark all read</button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'all', label: 'All', count: notifications.length }, { value: 'unread', label: 'Unread', count: unread.length }, { value: 'alert', label: 'Alerts' }]} />
      <div className="card divide-y divide-line">
        {rows.map((n) => (
          <div key={n.id} className={clsx('flex items-start gap-3 p-3.5', !n.read && 'bg-primary-light/40')}>
            <span className={clsx('rounded-lg p-2', n.type === 'alert' ? 'bg-danger-light text-danger' : 'bg-primary-light text-primary-dark')}>{n.type === 'alert' ? <AlertTriangle size={16} aria-hidden /> : <Info size={16} aria-hidden />}</span>
            <div className="min-w-0 flex-1">
              <p className={clsx('text-sm font-semibold', n.type === 'alert' && 'text-danger-dark')}>{n.title}</p>
              <p className="text-sm text-gray-700">{n.body}</p>
              <p className="text-xs text-ink-muted">{fmtTimeAgo(n.at)}</p>
            </div>
            <div className="flex shrink-0 gap-1">
              {reachable(n) && <Link to={n.link} className="btn-outline btn-sm" onClick={() => updateItem('notifications', n.id, { read: true }, 'Notification')}>Open</Link>}
              {!n.read && <button type="button" className="btn-ghost btn-sm" onClick={() => updateItem('notifications', n.id, { read: true }, 'Notification')}>Mark read</button>}
            </div>
          </div>
        ))}
        {!rows.length && <EmptyState icon={Bell} title="You are all caught up" />}
      </div>
    </div>
  );
}

const SAMPLE_VARS = { name: 'Sara Ali', awb: 'SLX100123', merchant: 'Noor Cosmetics', city: 'Lahore', eta: '12 Nov', cod: 'Rs 3,500', link: 'yourdomain.com/track/SLX100123' };

export function Templates() {
  const { templates, updateItem, addItem } = useData();
  const [channel, setChannel] = useState('WhatsApp');
  const [edit, setEdit] = useState(null);
  const [body, setBody] = useState('');
  const [subject, setSubject] = useState('');
  const rows = templates.filter((t) => t.channel === channel);
  const unknown = useMemo(() => [...body.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((v) => !(v in SAMPLE_VARS)), [body]);
  const open = (t) => { setEdit(t); setBody(t.body); setSubject(t.subject); };
  const save = () => {
    updateItem('templates', edit.id, { body, subject }, 'Template', `${edit.status} ${edit.channel} template edited`);
    toast.success('Template saved');
    setEdit(null);
  };
  const testSend = () => {
    addItem('sendLog', { id: uid('MSG'), awb: SAMPLE_VARS.awb, to: 'Test recipient', channel: edit.channel, event: edit.status, status: 'Delivered', at: new Date().toISOString() }, 'Notification', 'Test message');
    toast.success(`Test ${edit.channel} logged (no real message is sent)`);
  };
  return (
    <div>
      <PageHeader title="Templates" subtitle="One message per status and channel. Variables fill in at send time." />
      <Tabs value={channel} onChange={setChannel} tabs={CHANNELS.map((c) => ({ value: c, label: c }))} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((t) => (
          <Card key={t.id} title={t.status} actions={<Toggle label={`${t.status} ${t.channel} enabled`} checked={t.enabled} onChange={(v) => { updateItem('templates', t.id, { enabled: v }, 'Template', `${t.status} ${t.channel} ${v ? 'on' : 'off'}`); toast.info(`${t.status} ${v ? 'enabled' : 'disabled'}`); }} />}>
            <p className="mb-3 min-h-10 text-sm text-gray-700">{t.body}</p>
            <button type="button" className="btn-outline btn-sm" onClick={() => open(t)}><Pencil size={13} aria-hidden /> Edit</button>
          </Card>
        ))}
      </div>
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={`${edit?.status} - ${edit?.channel}`}
        footer={<><button type="button" className="btn-outline me-auto" onClick={testSend}><Send size={15} aria-hidden /> Test send</button><button type="button" className="btn-outline" onClick={() => setEdit(null)}>Cancel</button><button type="button" className="btn-primary" disabled={!body.trim() || unknown.length > 0} onClick={save}>Save</button></>}
      >
        {edit?.channel === 'Email' && <><label htmlFor="ts" className="label">Subject</label><input id="ts" className="input mb-3" value={subject} onChange={(e) => setSubject(e.target.value)} /></>}
        <label htmlFor="tb" className="label">Message</label>
        <textarea id="tb" rows={4} className={clsx('input', unknown.length > 0 && 'input-error')} value={body} onChange={(e) => setBody(e.target.value)} />
        {unknown.length > 0 && <p role="alert" className="mt-1 text-xs font-medium text-danger">Unknown variable: {unknown.join(', ')}</p>}
        <div className="my-2 flex flex-wrap gap-1.5">
          {TEMPLATE_VARS.map((v) => <button key={v} type="button" className="chip hover:bg-primary-light" onClick={() => setBody((b) => `${b}${b.endsWith(' ') || !b ? '' : ' '}${v}`)}>{v}</button>)}
        </div>
        <p className="label mt-3">Preview</p>
        <p className="rounded-lg bg-primary-light p-3 text-sm">{fillTemplate(body, SAMPLE_VARS)}</p>
      </Modal>
    </div>
  );
}

export function SendLog() {
  const { sendLog, updateItem } = useData();
  return (
    <div>
      <PageHeader title="Send Log" subtitle="Demo log. No real messages are sent." />
      <DataTable
        data={sendLog}
        exportName="send-log"
        dateKey="at"
        rowClass={(m) => (m.status === 'Failed' ? 'bg-danger-light/40' : '')}
        filters={[{ key: 'channel', label: 'Channel', options: CHANNELS }, { key: 'status', label: 'Status', options: ['Delivered', 'Sent', 'Failed', 'Queued'] }]}
        columns={[
          { key: 'at', header: 'Time', render: (m) => fmtDateTime(m.at), exportValue: (m) => fmtDateTime(m.at) },
          { key: 'channel', header: 'Channel' },
          { key: 'to', header: 'To' },
          { key: 'awb', header: 'AWB' },
          { key: 'event', header: 'Event' },
          { key: 'state', header: 'Result', value: (m) => m.status, render: (m) => <span className={clsx('text-xs font-semibold', m.status === 'Failed' ? 'text-danger' : m.status === 'Delivered' ? 'text-primary-dark' : 'text-ink-muted')}>{m.status}</span> },
          { key: 'act', header: '', sortable: false, export: false, render: (m) => m.status === 'Failed' && <button type="button" className="btn-outline btn-sm" onClick={() => { updateItem('sendLog', m.id, { status: 'Queued', at: new Date().toISOString() }, 'Notification', `${m.id} retried`); toast.info('Message queued again'); }}><RotateCw size={13} aria-hidden /> Retry</button> },
        ]}
      />
    </div>
  );
}
