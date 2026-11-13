import { useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { AlertTriangle, Bell, Info } from 'lucide-react';
import DataTable from '../../components/tables/DataTable.jsx';
import { EmptyState, PageHeader, Tabs } from '../../components/ui/index.jsx';
import { useData } from '../../store/dataStore.js';
import { toast } from '../../store/uiStore.js';
import { useCan } from '../../hooks/useApp.js';

import { fmtTimeAgo } from '../../utils/format.js';

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

