import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Pencil, Plug, Plus, RotateCcw, Trash2 } from 'lucide-react';
import DataTable from '../../components/tables/DataTable.jsx';
import { Card, PageHeader, StatusBadge, Tabs, Toggle } from '../../components/ui/index.jsx';
import { FormModal } from '../../components/forms/EntityForm.jsx';
import { useAuth } from '../../store/authStore.js';
import { useData } from '../../store/dataStore.js';
import { confirm, toast } from '../../store/uiStore.js';
import { useLookups } from '../../hooks/useApp.js';
import { ROLE_LABELS } from '../../data/config.js';
import { ACTIONS, MODULES, defaultPermissions } from '../../data/config.js';
import { SHIPMENT_STATUSES } from '../../utils/status.js';
import { fmtDateTime, groupBy, uid } from '../../utils/format.js';

const ROLE_OPTIONS = Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }));

export function PermissionMatrix() {
  const { permissions, setValue } = useData();
  const [role, setRole] = useState('branch_manager');
  const locked = role === 'super_admin';
  const toggle = (mod, action, v) => {
    const next = { ...permissions, [role]: { ...permissions[role], [mod]: { ...permissions[role][mod], [action]: v } } };
    // Without "view" the other rights mean nothing, so they go together.
    if (action === 'view' && !v) ACTIONS.forEach((a) => { next[role][mod][a] = false; });
    if (action !== 'view' && v) next[role][mod].view = true;
    setValue('permissions', next, 'Permissions', `${ROLE_LABELS[role]}: ${mod}.${action} ${v ? 'granted' : 'revoked'}`);
  };
  return (
    <Card
      title="Permission matrix"
      bodyClass=""
      actions={(
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Role" className="input !w-auto !py-1.5 !text-xs" value={role} onChange={(e) => setRole(e.target.value)}>{ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
          <button type="button" className="btn-outline btn-sm" disabled={locked} onClick={async () => { if (await confirm({ title: 'Reset permissions?', message: `${ROLE_LABELS[role]} returns to its default access.`, confirmLabel: 'Reset' })) { setValue('permissions', { ...permissions, [role]: defaultPermissions[role] }, 'Permissions', `${ROLE_LABELS[role]} reset`); toast.success('Permissions reset'); } }}><RotateCcw size={13} aria-hidden /> Reset</button>
        </div>
      )}
    >
      <p className="border-b border-line bg-surface px-4 py-2 text-xs text-ink-muted">{locked ? 'Super Admin always has full access.' : '"View" controls the sidebar and screen access straight away. Create, edit and delete are stored here; Export hides the export button on main lists.'}</p>
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface text-xs text-ink-muted"><tr><th className="px-4 py-2 text-start font-medium">Module</th>{ACTIONS.map((a) => <th key={a} className="px-3 py-2 text-center font-medium capitalize">{a}</th>)}</tr></thead>
          <tbody>
            {MODULES.map(([key, label]) => (
              <tr key={key} className="border-t border-line">
                <td className="whitespace-nowrap px-4 py-2 font-medium">{label}</td>
                {ACTIONS.map((a) => (
                  <td key={a} className="px-3 py-2 text-center">
                    <input type="checkbox" className="h-4 w-4 accent-primary-hover" aria-label={`${label} ${a}`} disabled={locked} checked={locked || !!permissions[role][key]?.[a]} onChange={(e) => toggle(key, a, e.target.checked)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function UsersRoles() {
  const lookups = useLookups();
  const me = useAuth((s) => s.user);
  const { users, addItem, updateItem, removeItem } = useData();
  const [tab, setTab] = useState('users');
  const [edit, setEdit] = useState(null);
  const del = async (u) => {
    if (u.id === me.id) { toast.error('You cannot delete your own account'); return; }
    if (await confirm({ title: 'Delete user?', message: `${u.name} will lose access.`, confirmLabel: 'Delete' })) { removeItem('users', u.id, 'User'); toast.success('User deleted'); }
  };
  return (
    <div>
      <PageHeader title="Users & Roles" actions={tab === 'users' && <button type="button" className="btn-primary" onClick={() => setEdit({})}><Plus size={16} aria-hidden /> Add user</button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'users', label: 'Users', count: users.length }, { value: 'roles', label: 'Roles & permissions' }]} />
      {tab === 'users' && (
        <DataTable
          data={users}
          exportName="users"
          filters={[{ key: 'role', label: 'Role', options: ROLE_OPTIONS }, { key: 'status', label: 'Status', options: ['Active', 'Inactive'] }]}
          columns={[
            { key: 'name', header: 'Name' },
            { key: 'email', header: 'Email' },
            { key: 'roleName', header: 'Role', value: (u) => ROLE_LABELS[u.role] },
            { key: 'branch', header: 'Branch', value: (u) => (u.branchId ? lookups.branchName(u.branchId) : 'All') },
            { key: 'lastLogin', header: 'Last login', render: (u) => fmtDateTime(u.lastLogin), exportValue: (u) => fmtDateTime(u.lastLogin) },
            { key: 'status', header: 'Status', render: (u) => <StatusBadge status={u.status} />, value: (u) => u.status },
            { key: 'act', header: '', sortable: false, export: false, render: (u) => <span className="flex gap-1"><button type="button" className="btn-ghost btn-sm" onClick={() => setEdit(u)} aria-label={`Edit ${u.name}`}><Pencil size={14} /></button><button type="button" className="btn-ghost btn-sm hover:!text-danger" onClick={() => del(u)} aria-label={`Delete ${u.name}`}><Trash2 size={14} /></button></span> },
          ]}
        />
      )}
      {tab === 'roles' && <PermissionMatrix />}
      <FormModal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? `Edit ${edit.name}` : 'Add user'}
        fields={[
          { name: 'name', label: 'Full name', required: true },
          { name: 'email', label: 'Email', required: true, email: true },
          { name: 'role', label: 'Role', type: 'select', options: ROLE_OPTIONS, required: true },
          { name: 'branchId', label: 'Branch', type: 'select', options: lookups.branchOptions },
          { name: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive'], required: true, default: 'Active' },
        ]}
        defaultValues={edit}
        onSubmit={(v) => {
          if (users.some((u) => u.email.toLowerCase() === v.email.toLowerCase() && u.id !== edit.id)) { toast.error('Another user already has that email'); return; }
          if (edit.id) updateItem('users', edit.id, { ...v, branchId: v.branchId || null }, 'User', `${v.name} edited`);
          else addItem('users', { id: uid('U'), ...v, branchId: v.branchId || null, lastLogin: null }, 'User', `${v.name} added`);
          setEdit(null);
          toast.success('User saved');
        }}
      />
    </div>
  );
}

export function AuditLog() {
  const auditLog = useData((s) => s.auditLog);
  const entities = [...new Set(auditLog.map((a) => a.entity))].sort();
  const users = [...new Set(auditLog.map((a) => a.user))].sort();
  return (
    <div>
      <PageHeader title="Audit Log" subtitle="Who changed what, including cash and status changes. Actions in this browser are listed here." />
      <DataTable
        data={auditLog}
        exportName="audit-log"
        dateKey="at"
        pageSize={25}
        filters={[{ key: 'entity', label: 'Area', options: entities }, { key: 'user', label: 'User', options: users }]}
        columns={[
          { key: 'at', header: 'Time', render: (a) => fmtDateTime(a.at), exportValue: (a) => fmtDateTime(a.at) },
          { key: 'user', header: 'User' },
          { key: 'role', header: 'Role' },
          { key: 'entity', header: 'Area' },
          { key: 'action', header: 'Action' },
          { key: 'detail', header: 'Detail', className: 'max-w-[360px] truncate' },
          { key: 'ip', header: 'IP', hidden: true },
        ]}
      />
    </div>
  );
}

export function SystemSettings() {
  const { settings, setValue, resetDemo } = useData();
  const [tab, setTab] = useState('company');
  const { register, handleSubmit, formState: { errors, isDirty }, reset } = useForm({ defaultValues: settings });
  const save = (v) => {
    const next = { ...settings, ...v };
    setValue('settings', next, 'Settings', 'System settings updated');
    reset(next);
    toast.success('Settings saved');
  };
  const onLogo = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please choose an image file'); return; }
    if (file.size > 300 * 1024) { toast.error('Please use a logo under 300 KB'); return; }
    const reader = new FileReader();
    reader.onload = () => { setValue('settings', { ...settings, logo: reader.result }, 'Settings', 'Logo updated'); toast.success('Logo updated. It appears on printed documents.'); };
    reader.readAsDataURL(file);
  };
  const toggleNotify = (k, v) => setValue('settings', { ...settings, notify: { ...settings.notify, [k]: v } }, 'Settings', `Notification ${k} ${v ? 'on' : 'off'}`);
  const statusName = (s, v) => setValue('settings', { ...settings, statusNames: { ...settings.statusNames, [s]: v } }, 'Settings', `Status alias for ${s}`);
  const f = (name, label, opts = {}, type = 'text') => (
    <div>
      <label htmlFor={name} className="label">{label}</label>
      <input id={name} type={type} className={`input ${errors[name] ? 'input-error' : ''}`} {...register(name, { required: opts.required ? `${label} is required` : false, min: opts.min !== undefined ? { value: opts.min, message: `${label} must be at least ${opts.min}` } : undefined })} />
      {errors[name] && <p role="alert" className="mt-1 text-xs font-medium text-danger">{errors[name].message}</p>}
    </div>
  );
  return (
    <div>
      <PageHeader title="Settings" />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'company', label: 'Company' }, { value: 'labels', label: 'Labels & statuses' }, { value: 'notify', label: 'Notifications' }, { value: 'demo', label: 'Local data' }]} />
      {(tab === 'company' || tab === 'labels') && (
        <form onSubmit={handleSubmit(save)} noValidate>
          {tab === 'company' && (
            <Card title="Company profile">
              <div className="grid gap-3 sm:grid-cols-2">
                {f('company', 'Company name', { required: true })}
                {f('product', 'Product name', { required: true })}
                {f('tagline', 'Tagline')}
                {f('email', 'Email', {}, 'email')}
                {f('phone', 'Phone')}
                {f('ntn', 'Tax number')}
                <div className="sm:col-span-2">{f('address', 'Address')}</div>
                <div className="sm:col-span-2">
                  <label htmlFor="logo" className="label">Logo</label>
                  <div className="flex items-center gap-3">
                    {settings.logo && <img src={settings.logo} alt="Company logo" className="h-10 w-10 rounded object-contain" />}
                    <input id="logo" type="file" accept="image/*" className="text-sm" onChange={onLogo} />
                  </div>
                </div>
              </div>
            </Card>
          )}
          {tab === 'labels' && (
            <Card title="Default label format">
              <select aria-label="Label format" className="input sm:max-w-xs" {...register('labelFormat')}>
                <option value="4x6">4x6 Thermal</option><option value="a5">A5</option><option value="a4">A4</option>
              </select>
              <p className="label mb-2 mt-5">Status display aliases (recorded for rollout; screens show the standard names)</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {SHIPMENT_STATUSES.map((s) => <div key={s}><label htmlFor={`st-${s}`} className="text-xs text-ink-muted">{s}</label><input id={`st-${s}`} className="input" placeholder={s} defaultValue={settings.statusNames[s] || ''} onBlur={(e) => { if ((settings.statusNames[s] || '') !== e.target.value) statusName(s, e.target.value); }} /></div>)}
              </div>
            </Card>
          )}
          <button type="submit" className="btn-primary mt-4" disabled={!isDirty}>Save changes</button>
        </form>
      )}
      {tab === 'notify' && (
        <Card title="Notification toggles">
          <ul className="divide-y divide-line">
            {[['whatsapp', 'WhatsApp status updates'], ['sms', 'SMS status updates'], ['email', 'Email status updates'], ['codAlerts', 'COD and cash alerts'], ['slaAlerts', 'Support SLA alerts']].map(([k, l]) => (
              <li key={k} className="flex items-center justify-between py-2.5 text-sm">{l}<Toggle label={l} checked={!!settings.notify[k]} onChange={(v) => toggleNotify(k, v)} /></li>
            ))}
          </ul>
        </Card>
      )}
      {tab === 'demo' && (
        <Card title="Local data">
          <p className="mb-3 text-sm text-ink-muted">Shipments, COD, warehouse and the other operational records are still saved in this browser until those modules move to the database. Clearing them deletes them from this browser and resets settings. Users, branches and customer accounts in the database are not affected.</p>
          <button type="button" className="btn-danger" onClick={async () => { if (await confirm({ title: 'Clear local data?', message: 'All shipments and other operational records saved in this browser will be deleted.', confirmLabel: 'Clear data' })) { resetDemo(); reset(useData.getState().settings); toast.success('Local data cleared'); } }}><RotateCcw size={15} aria-hidden /> Clear local data</button>
        </Card>
      )}
    </div>
  );
}

export function Integrations() {
  const { integrations, updateItem } = useData();
  const groups = groupBy(integrations, (i) => i.group);
  const toggle = async (i) => {
    const connected = i.status === 'Connected';
    if (connected && !(await confirm({ title: `Disconnect ${i.name}?`, message: 'It will stop syncing until it is connected again.', confirmLabel: 'Disconnect' }))) return;
    const status = connected ? 'Disconnected' : 'Connected';
    updateItem('integrations', i.id, { status }, 'Integration', `${i.name} ${status}`);
    toast.success(`${i.name} ${status.toLowerCase()} (not live yet)`);
  };
  return (
    <div>
      <PageHeader title="Integrations" subtitle="Connect and disconnect screens only. Nothing calls a live service yet." />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {Object.entries(groups).map(([group, list]) => (
          <Card key={group} title={group} bodyClass="">
            <ul className="divide-y divide-line">
              {list.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="rounded-lg bg-primary-light p-2 text-primary-dark"><Plug size={16} aria-hidden /></span>
                  <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{i.name}</span><span className="block text-xs text-ink-muted">{i.desc}</span></span>
                  <StatusBadge status={i.status} />
                  <button type="button" className={i.status === 'Connected' ? 'btn-outline btn-sm' : 'btn-primary btn-sm'} onClick={() => toggle(i)}>{i.status === 'Connected' ? 'Disconnect' : 'Connect'}</button>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}
