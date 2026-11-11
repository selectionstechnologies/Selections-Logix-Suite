// Users & Roles backed by the database. Only the Super Admin creates logins (through the
// admin-users Edge Function). The form changes with the role:
//   staff roles  -> employee code, designation, joining date, shift, salary, emergency contact
//   rider        -> city, zone, vehicle, plate, licence and expiry, emergency contact
//   merchant     -> picks the customer account the login belongs to
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import clsx from 'clsx';
import { Bike, Building2, Calculator, Crown, KeyRound, Loader2, Pencil, Plus, Power, RefreshCw, Store, Warehouse } from 'lucide-react';
import DataTable from '../../components/tables/DataTable.jsx';
import { Drawer, PageHeader, PageSkeleton, StatCard, StatusBadge, Tabs } from '../../components/ui/index.jsx';
import { FieldError, FormModal } from '../../components/forms/EntityForm.jsx';
import { PermissionMatrix } from '../admin/index.jsx';
import { useAuth } from '../../store/authStore.js';
import { confirm, toast } from '../../store/uiStore.js';
import { ROLE_LABELS } from '../../data/config.js';
import { CITY_NAMES, ZONES } from '../../data/geo.js';
import { formatCnic, fmtDate } from '../../utils/format.js';
import {
  EMAIL_MESSAGE, PASSWORD_MESSAGE, cleanPhoneInput, isEmail, isFuture, isLicence, isPlate, isStrongPassword, notFuture, phoneInputProps,
  zCnicOptional, zPersonName, zPersonNameOptional, zPhone, zPhoneOptional,
} from '../../utils/validation.js';
import { syncFromDb } from '../../hooks/useDbSync.js';
import {
  SHIFTS, VEHICLE_TYPES, createUser, listBranches, listCustomersWithoutLogin, listUsers, setUserPassword, updateUser,
} from '../../lib/api.js';

const ROLE_ICONS = { super_admin: Crown, branch_manager: Building2, accountant: Calculator, warehouse: Warehouse, rider: Bike, merchant: Store };
const ROLE_OPTIONS = Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }));
const STAFF_ROLES = ['super_admin', 'branch_manager', 'accountant', 'warehouse'];
const BRANCH_REQUIRED = ['branch_manager', 'warehouse', 'rider'];
const DEPARTMENT = { super_admin: 'Management', branch_manager: 'Operations', accountant: 'Finance', warehouse: 'Warehouse' };

const one = (x) => (Array.isArray(x) ? x[0] : x) || null;

const schema = z.object({
  mode: z.enum(['create', 'edit']),
  role: z.string().min(1, 'Choose a role'),
  customer_id: z.string(),
  full_name: zPersonName('Full name'),
  email: z.string().trim(),
  password: z.string(),
  phone: zPhone('Phone'),
  cnic: zCnicOptional(),
  address: z.string().trim().max(250, 'Address must be at most 250 characters'),
  branch_id: z.string(),
  status: z.string(),
  // staff
  employee_code: z.string().trim().refine((v) => !v || /^[A-Za-z0-9-]{2,20}$/.test(v), 'Letters, numbers and - only (2-20)'),
  designation: z.string().trim().max(60, 'At most 60 characters'),
  department: z.string().trim().max(60, 'At most 60 characters'),
  joining_date: z.string(),
  shift: z.string(),
  salary: z.string(),
  // rider
  city: z.string(),
  zone: z.string(),
  vehicle_type: z.string(),
  vehicle_plate: z.string().trim(),
  license_no: z.string().trim(),
  license_expiry: z.string(),
  // both
  emergency_contact_name: zPersonNameOptional(),
  emergency_contact_phone: zPhoneOptional(),
}).superRefine((v, ctx) => {
  const add = (path, message) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (v.mode === 'create') {
    if (!isEmail(v.email)) add('email', EMAIL_MESSAGE);
    if (!isStrongPassword(v.password)) add('password', PASSWORD_MESSAGE);
  }
  if (BRANCH_REQUIRED.includes(v.role) && !v.branch_id) add('branch_id', 'Branch is required for this role');
  if (v.role === 'merchant' && v.mode === 'create' && !v.customer_id) add('customer_id', 'Pick the customer account');
  if (v.role === 'rider') {
    if (!v.vehicle_type) add('vehicle_type', 'Vehicle type is required');
    if (!v.license_no) add('license_no', 'Licence number is required');
    else if (!isLicence(v.license_no)) add('license_no', 'Letters, numbers, - and / only (4-20)');
    if (v.vehicle_plate && !isPlate(v.vehicle_plate)) add('vehicle_plate', 'Use a plate like LEA-1234');
    if (v.license_expiry && !isFuture(v.license_expiry)) add('license_expiry', 'This licence has expired');
    if (v.zone && v.city && !(ZONES[v.city] || []).some((z) => z.value === v.zone)) add('zone', 'Choose a zone in this city');
  }
  if (v.joining_date && !notFuture(v.joining_date)) add('joining_date', 'Joining date cannot be in the future');
  if (v.salary && !(Number(v.salary) >= 0 && Number(v.salary) <= 10000000)) add('salary', 'Enter a valid amount');
  if (v.emergency_contact_phone && v.emergency_contact_phone.replace(/\D/g, '').slice(-10) === v.phone.replace(/\D/g, '').slice(-10)) {
    add('emergency_contact_phone', 'Use a different number from the user\'s own phone');
  }
});

const BLANK = {
  mode: 'create', role: '', customer_id: '', full_name: '', email: '', password: '', phone: '', cnic: '', address: '', branch_id: '', status: 'Active',
  employee_code: '', designation: '', department: '', joining_date: '', shift: '', salary: '',
  city: '', zone: '', vehicle_type: 'Motorcycle', vehicle_plate: '', license_no: '', license_expiry: '',
  emergency_contact_name: '', emergency_contact_phone: '',
};

const s = (v) => (v === null || v === undefined ? '' : String(v));
const fromUser = (u) => {
  const st = one(u.staff) || {};
  const r = one(u.rider) || {};
  return {
    ...BLANK, mode: 'edit', role: u.role, full_name: u.full_name, email: u.email, phone: s(u.phone), cnic: s(u.cnic), address: s(u.address), branch_id: s(u.branch_id), status: u.status,
    employee_code: s(st.employee_code), designation: s(st.designation), department: s(st.department), joining_date: s(st.joining_date), shift: s(st.shift), salary: s(st.salary),
    city: s(r.city), zone: s(r.zone), vehicle_type: r.vehicle_type || 'Motorcycle', vehicle_plate: s(r.vehicle_plate), license_no: s(r.license_no), license_expiry: s(r.license_expiry),
    emergency_contact_name: s(st.emergency_contact_name || r.emergency_contact_name), emergency_contact_phone: s(st.emergency_contact_phone || r.emergency_contact_phone),
  };
};

function F({ label, name, register, errors, required, type = 'text', className, children, format, ...rest }) {
  const id = `uf-${name}`;
  const reg = register(name);
  const onChange = format ? (e) => { e.target.value = format(e.target.value); return reg.onChange(e); } : reg.onChange;
  const cls = clsx('input', errors[name] && 'input-error');
  return (
    <div className={className}>
      <label htmlFor={id} className="label">{label}{required && <span className="text-danger"> *</span>}</label>
      {children ? <select id={id} className={cls} {...reg}>{children}</select> : <input id={id} type={type} className={cls} {...rest} {...reg} onChange={onChange} />}
      <FieldError message={errors[name]?.message} />
    </div>
  );
}

const Section = ({ title, children }) => (
  <fieldset className="rounded-xl border border-line p-3">
    <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">{title}</legend>
    <div className="grid gap-3 sm:grid-cols-2">{children}</div>
  </fieldset>
);

function UserDrawer({ open, onClose, editing, branches, onSaved }) {
  const isEdit = Boolean(editing?.id);
  const [customers, setCustomers] = useState([]);
  const { register, handleSubmit, watch, reset, setValue, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema), mode: 'onTouched', defaultValues: BLANK });

  useEffect(() => {
    if (!open) return;
    reset(isEdit ? fromUser(editing) : { ...BLANK, role: editing?.role || '' });
    if (!isEdit) listCustomersWithoutLogin().then(setCustomers).catch(() => setCustomers([]));
  }, [open, editing, isEdit, reset]);

  const role = watch('role');
  const city = watch('city');
  const customerId = watch('customer_id');
  const zones = ZONES[city] || [];

  // Picking a customer account fills the login from what is saved on that account, and checks
  // it straight away so an old value that breaks today's rules (e.g. a bad phone) shows up now.
  const selectedCustomer = customers.find((x) => x.id === customerId);
  useEffect(() => {
    const c = selectedCustomer;
    if (!c) return;
    const opts = { shouldValidate: true, shouldDirty: true };
    setValue('full_name', c.owner_name || '', opts);
    setValue('phone', c.phone || '', opts);
    setValue('email', c.email || '', opts);
    setValue('cnic', c.cnic || '', opts);
    setValue('address', [c.office_address, c.city].filter(Boolean).join(', '), opts);
    setValue('branch_id', c.branch_id || '', opts);
  }, [customerId, customers.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!isEdit && STAFF_ROLES.includes(role) && !watch('department')) setValue('department', DEPARTMENT[role]); }, [role]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSubmit = async (v) => {
    const staff = STAFF_ROLES.includes(v.role) ? {
      employee_code: v.employee_code, designation: v.designation, department: v.department, joining_date: v.joining_date, shift: v.shift, salary: v.salary,
      emergency_contact_name: v.emergency_contact_name, emergency_contact_phone: v.emergency_contact_phone,
    } : undefined;
    const rider = v.role === 'rider' ? {
      city: v.city, zone: v.zone, vehicle_type: v.vehicle_type, vehicle_plate: v.vehicle_plate, license_no: v.license_no, license_expiry: v.license_expiry,
      emergency_contact_name: v.emergency_contact_name, emergency_contact_phone: v.emergency_contact_phone,
    } : undefined;
    const base = { full_name: v.full_name, phone: v.phone, cnic: v.cnic, address: v.address, branch_id: v.branch_id || null, staff, rider };
    try {
      if (isEdit) {
        await updateUser(editing.id, { ...base, status: v.status });
        toast.success('User updated');
      } else {
        await createUser({ ...base, role: v.role, email: v.email, password: v.password, customer_id: v.customer_id || undefined });
        toast.success(`${ROLE_LABELS[v.role]} account created for ${v.full_name}`);
      }
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const p = { register, errors };
  const isStaff = STAFF_ROLES.includes(role);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="max-w-2xl"
      title={isEdit ? `Edit ${editing.full_name}` : 'Add user'}
      footer={(
        <>
          <button type="button" className="btn-outline" onClick={onClose}>Cancel</button>
          <button type="submit" form="user-form" className="btn-primary" disabled={isSubmitting || !role}>
            {isSubmitting && <Loader2 size={16} className="animate-spin" aria-hidden />} {isEdit ? 'Save changes' : 'Create user'}
          </button>
        </>
      )}
    >
      <form id="user-form" onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        {!isEdit && (
          <div>
            <p className="label">Role <span className="text-danger">*</span></p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ROLE_OPTIONS.map((o) => {
                const Icon = ROLE_ICONS[o.value];
                return (
                  <label key={o.value} className={clsx('flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm', role === o.value ? 'border-primary-hover bg-primary-light font-medium' : 'border-line hover:bg-surface')}>
                    <input type="radio" value={o.value} className="sr-only" {...register('role')} />
                    <Icon size={16} className="shrink-0 text-ink-muted" aria-hidden /> {o.label}
                  </label>
                );
              })}
            </div>
            <FieldError message={errors.role?.message} />
          </div>
        )}

        {role === 'merchant' && !isEdit && (
          <Section title="Customer account">
            <F label="Customer account" name="customer_id" required className="sm:col-span-2" {...p}>
              <option value="">Select a customer without a login...</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.business_name} ({c.account_no})</option>)}
            </F>
            {selectedCustomer && (
              <p className="text-xs text-ink-muted sm:col-span-2">
                Details below are filled from account {selectedCustomer.account_no}. If one is wrong, fix it on the{' '}
                <Link to={`/accounts/customers/${selectedCustomer.id}/edit`} className="font-medium text-ink underline" onClick={onClose}>customer account</Link> so both stay the same.
              </p>
            )}
            <p className="text-xs text-ink-muted sm:col-span-2">
              Not in the list? <Link to="/accounts/customers/new" className="font-medium text-ink underline" onClick={onClose}>Create the customer account</Link> first; it can create the login in the same step.
            </p>
          </Section>
        )}

        {role && (
          <Section title="Login & personal details">
            <F label="Full name" name="full_name" required maxLength={80} placeholder="e.g. Bilal Ahmed" {...p} />
            <F label="Phone #" name="phone" required {...phoneInputProps} format={cleanPhoneInput} {...p} />
            {!isEdit && <F label="Login email" name="email" type="email" required autoComplete="off" maxLength={254} placeholder="name@company.com" {...p} />}
            {!isEdit && <F label="Temporary password" name="password" type="password" required autoComplete="new-password" maxLength={72} placeholder="8+ characters, a letter and a number" {...p} />}
            <F label="CNIC" name="cnic" placeholder="35202-1234567-1" inputMode="numeric" maxLength={15} format={formatCnic} {...p} />
            {role !== 'super_admin' && (
              <F label="Branch" name="branch_id" required={BRANCH_REQUIRED.includes(role)} {...p}>
                <option value="">{BRANCH_REQUIRED.includes(role) ? 'Select...' : 'All branches'}</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.id})</option>)}
              </F>
            )}
            <F label="Address" name="address" className="sm:col-span-2" maxLength={250} placeholder="House / flat, street, area, city" {...p} />
            {isEdit && (
              <F label="Status" name="status" {...p}>
                <option>Active</option><option>Inactive</option>
              </F>
            )}
          </Section>
        )}

        {isStaff && (
          <Section title="Employment">
            <F label="Employee code" name="employee_code" placeholder="e.g. EMP-0012" maxLength={20} format={(x) => x.toUpperCase()} {...p} />
            <F label="Designation" name="designation" placeholder={role === 'warehouse' ? 'e.g. Warehouse Supervisor' : role === 'accountant' ? 'e.g. Senior Accountant' : 'e.g. Branch Manager'} {...p} />
            <F label="Department" name="department" placeholder="e.g. Operations" {...p} />
            <F label="Joining date" name="joining_date" type="date" max={new Date().toISOString().slice(0, 10)} {...p} />
            <F label="Shift" name="shift" {...p}><option value="">-</option>{SHIFTS.map((x) => <option key={x}>{x}</option>)}</F>
            <F label="Monthly salary (PKR)" name="salary" type="number" min="0" step="1" placeholder="Optional, e.g. 45000" {...p} />
          </Section>
        )}

        {role === 'rider' && (
          <Section title="Rider & vehicle">
            <F label="City" name="city" {...p}><option value="">Select...</option>{CITY_NAMES.map((c) => <option key={c}>{c}</option>)}</F>
            <F label="Zone" name="zone" {...p}><option value="">{city ? 'Select...' : 'Pick a city first'}</option>{zones.map((z) => <option key={z.value} value={z.value}>{z.value} ({z.areas})</option>)}</F>
            <F label="Vehicle type" name="vehicle_type" required {...p}>{VEHICLE_TYPES.map((x) => <option key={x}>{x}</option>)}</F>
            <F label="Vehicle plate #" name="vehicle_plate" placeholder="LEA-1234" maxLength={12} format={(x) => x.toUpperCase()} {...p} />
            <F label="Driving licence #" name="license_no" required maxLength={20} format={(x) => x.toUpperCase()} {...p} />
            <F label="Licence expiry" name="license_expiry" type="date" min={new Date().toISOString().slice(0, 10)} {...p} />
          </Section>
        )}

        {(isStaff || role === 'rider') && (
          <Section title="Emergency contact">
            <F label="Name" name="emergency_contact_name" maxLength={80} placeholder="e.g. father / spouse name" {...p} />
            <F label="Phone #" name="emergency_contact_phone" {...phoneInputProps} format={cleanPhoneInput} {...p} />
          </Section>
        )}

        {!role && <p className="text-sm text-ink-muted">Choose a role to see its form.</p>}
      </form>
    </Drawer>
  );
}

const PASSWORD_FIELDS = [{ name: 'password', label: 'New password', type: 'password', required: true, password: true, full: true }];

export function UsersAdmin() {
  const me = useAuth((st) => st.user);
  const [tab, setTab] = useState('users');
  const [users, setUsers] = useState(null);
  const [branches, setBranches] = useState([]);
  const [editing, setEditing] = useState(null); // null closed, {} new, {role} new with role, user to edit
  const [pwFor, setPwFor] = useState(null);

  const load = useCallback(() => Promise.all([listUsers(), listBranches()])
    .then(([u, b]) => { setUsers(u); setBranches(b); })
    .catch((e) => { toast.error(e.message); setUsers([]); }), []);
  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => Object.fromEntries(ROLE_OPTIONS.map((o) => [o.value, (users || []).filter((u) => u.role === o.value).length])), [users]);

  if (!users) return <PageSkeleton />;

  const toggleActive = async (u) => {
    if (u.id === me.id) { toast.error('You cannot deactivate your own account'); return; }
    const next = u.status === 'Active' ? 'Inactive' : 'Active';
    if (next === 'Inactive' && !(await confirm({ title: 'Deactivate user?', message: `${u.full_name} will be signed out and cannot log in until reactivated.`, confirmLabel: 'Deactivate' }))) return;
    try { await updateUser(u.id, { status: next }); toast.success(`${u.full_name} ${next === 'Active' ? 'activated' : 'deactivated'}`); load(); } catch (e) { toast.error(e.message); }
  };

  const columns = [
    { key: 'full_name', header: 'Name', render: (u) => <span className="font-medium">{u.full_name}</span> },
    { key: 'email', header: 'Email' },
    { key: 'role', header: 'Role', value: (u) => ROLE_LABELS[u.role] },
    { key: 'branch', header: 'Branch', value: (u) => u.branch?.name || (u.branch_id ? u.branch_id : 'All') },
    { key: 'phone', header: 'Phone' },
    { key: 'linked', header: 'Linked record', value: (u) => one(u.customer)?.business_name || one(u.rider)?.code || one(u.staff)?.employee_code || '-' },
    { key: 'status', header: 'Status', render: (u) => <StatusBadge status={u.status} /> },
    { key: 'created_at', header: 'Created', value: (u) => u.created_at, render: (u) => fmtDate(u.created_at), hidden: true },
    {
      key: 'actions', header: '', export: false, render: (u) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()} role="presentation">
          <button type="button" className="btn-ghost btn-sm !p-1.5" aria-label={`Edit ${u.full_name}`} onClick={() => setEditing(u)}><Pencil size={14} /></button>
          <button type="button" className="btn-ghost btn-sm !p-1.5" aria-label={`Reset password for ${u.full_name}`} onClick={() => setPwFor(u)}><KeyRound size={14} /></button>
          <button type="button" className={clsx('btn-ghost btn-sm !p-1.5', u.status === 'Active' && 'text-danger')} aria-label={u.status === 'Active' ? 'Deactivate' : 'Activate'} onClick={() => toggleActive(u)}><Power size={14} /></button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Users & Roles"
        subtitle="Every login is created here by the Super Admin"
        actions={tab === 'users' && (
          <>
            <button type="button" className="btn-outline" onClick={load}><RefreshCw size={15} aria-hidden /> Refresh</button>
            <button type="button" className="btn-primary" onClick={() => setEditing({})}><Plus size={16} aria-hidden /> Add user</button>
          </>
        )}
      />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'users', label: 'Users', count: users.length }, { value: 'roles', label: 'Roles & permissions' }]} />
      {tab === 'users' && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {ROLE_OPTIONS.map((o) => <StatCard key={o.value} label={o.label} value={counts[o.value]} icon={ROLE_ICONS[o.value]} hint="Click to add" onClick={() => setEditing({ role: o.value })} />)}
          </div>
          <DataTable
            data={users}
            columns={columns}
            exportName="users"
            dateKey="created_at"
            filters={[
              { key: 'role', label: 'Role', options: ROLE_OPTIONS },
              { key: 'status', label: 'Status', options: ['Active', 'Inactive'] },
              { key: 'branch_id', label: 'Branch', options: branches.map((b) => ({ value: b.id, label: b.name })) },
            ]}
            onRowClick={(u) => setEditing(u)}
            emptyTitle="No users yet"
          />
        </>
      )}
      {tab === 'roles' && <PermissionMatrix />}

      <UserDrawer open={editing !== null} editing={editing} branches={branches} onClose={() => setEditing(null)} onSaved={() => { load(); syncFromDb().catch(() => {}); }} />

      <FormModal
        open={!!pwFor}
        onClose={() => setPwFor(null)}
        title={`Reset password: ${pwFor?.full_name || ''}`}
        fields={PASSWORD_FIELDS}
        submitLabel="Set password"
        onSubmit={async (v) => {
          try { await setUserPassword(pwFor.id, v.password); toast.success('Password updated. Share it with the user.'); setPwFor(null); } catch (e) { toast.error(e.message); }
        }}
      />
    </div>
  );
}
