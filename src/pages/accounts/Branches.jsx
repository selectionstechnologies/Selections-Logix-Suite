// Branch setup in the database (Super Admin). Branch ids are short codes such as LHE,
// which the operations screens also use, so they cannot change after creation.
import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import DataTable from '../../components/tables/DataTable.jsx';
import { PageHeader, PageSkeleton, StatusBadge } from '../../components/ui/index.jsx';
import { FormModal } from '../../components/forms/EntityForm.jsx';
import { confirm, toast } from '../../store/uiStore.js';
import { BRANCH_TYPES, CITY_NAMES } from '../../data/geo.js';
import { syncFromDb } from '../../hooks/useDbSync.js';
import { deleteBranch, listBranches, saveBranch } from '../../lib/api.js';

// The id is only asked for on creation; a disabled input would drop out of the form values.
const fields = (isNew) => [
  ...(isNew ? [{ name: 'id', label: 'Branch ID', required: true, pattern: /^[A-Z0-9]{2,10}$/, patternMessage: '2-10 capital letters or digits, e.g. LHE', help: 'Short code, cannot be changed later' }] : []),
  { name: 'code', label: 'Branch code', required: true, placeholder: 'LHE-01', pattern: /^[A-Z0-9]{2,10}-\d{2}$/, patternMessage: 'Use the format LHE-01' },
  { name: 'name', label: 'Branch name', required: true, full: true, maxLength: 80 },
  { name: 'type', label: 'Type', type: 'select', required: true, options: BRANCH_TYPES },
  { name: 'city', label: 'City', type: 'select', required: true, options: CITY_NAMES },
  { name: 'address', label: 'Address', full: true, maxLength: 200 },
  { name: 'phone', label: 'Phone', phone: true },
  { name: 'email', label: 'Email', email: true },
  { name: 'hours', label: 'Opening hours', placeholder: '09:00 - 18:00', pattern: /^([01]\d|2[0-3]):[0-5]\d\s*-\s*([01]\d|2[0-3]):[0-5]\d$/, patternMessage: 'Use the format 09:00 - 18:00' },
  { name: 'status', label: 'Status', type: 'select', required: true, options: ['Active', 'Inactive'] },
  { name: 'target_shipments', label: 'Daily shipment target', type: 'number', min: 0 },
  { name: 'target_revenue', label: 'Monthly revenue target (PKR)', type: 'number', min: 0 },
  { name: 'commission_pct', label: 'Franchise commission %', type: 'number', min: 0, max: 100 },
];

export function BranchSetup() {
  const [rows, setRows] = useState(null);
  const [edit, setEdit] = useState(null);
  const load = useCallback(() => listBranches().then(setRows).catch((e) => { toast.error(e.message); setRows([]); }), []);
  useEffect(() => { load(); }, [load]);
  if (!rows) return <PageSkeleton />;

  const isNew = edit && !edit.id;
  const remove = async (b) => {
    if (!(await confirm({ title: `Delete ${b.name}?`, message: 'This fails if users, riders or customers still belong to the branch. Consider setting it Inactive instead.', confirmLabel: 'Delete' }))) return;
    try { await deleteBranch(b.id); toast.success('Branch deleted'); load(); syncFromDb().catch(() => {}); } catch (e) { toast.error(e.message.includes('foreign key') ? 'Branch is still in use. Set it Inactive instead.' : e.message); }
  };

  return (
    <div>
      <PageHeader
        title="Branch Setup"
        subtitle={`${rows.length} branches in the database`}
        actions={(
          <>
            <button type="button" className="btn-outline" onClick={load}><RefreshCw size={15} aria-hidden /> Refresh</button>
            <button type="button" className="btn-primary" onClick={() => setEdit({})}><Plus size={16} aria-hidden /> Add branch</button>
          </>
        )}
      />
      <DataTable
        data={rows}
        exportName="branches"
        filters={[{ key: 'type', label: 'Type', options: BRANCH_TYPES }, { key: 'status', label: 'Status', options: ['Active', 'Inactive'] }]}
        onRowClick={setEdit}
        columns={[
          { key: 'id', header: 'ID', render: (b) => <span className="font-mono text-xs">{b.id}</span> },
          { key: 'code', header: 'Code' },
          { key: 'name', header: 'Name', render: (b) => <span className="font-medium">{b.name}</span> },
          { key: 'type', header: 'Type' },
          { key: 'city', header: 'City' },
          { key: 'phone', header: 'Phone' },
          { key: 'hours', header: 'Hours', hidden: true },
          { key: 'status', header: 'Status', render: (b) => <StatusBadge status={b.status} /> },
          {
            key: 'actions', header: '', export: false, render: (b) => (
              <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()} role="presentation">
                <button type="button" className="btn-ghost btn-sm !p-1.5" aria-label={`Edit ${b.name}`} onClick={() => setEdit(b)}><Pencil size={14} /></button>
                <button type="button" className="btn-ghost btn-sm !p-1.5 text-danger" aria-label={`Delete ${b.name}`} onClick={() => remove(b)}><Trash2 size={14} /></button>
              </div>
            ),
          },
        ]}
      />
      <FormModal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={isNew ? 'Add branch' : `Edit ${edit?.name || ''} (${edit?.id || ''})`}
        fields={fields(isNew)}
        defaultValues={isNew ? { type: 'Office', status: 'Active', target_shipments: 0, target_revenue: 0, commission_pct: 0 } : edit || undefined}
        onSubmit={async (v) => {
          try {
            const row = { ...v, id: isNew ? v.id.toUpperCase() : edit.id, target_shipments: v.target_shipments || 0, target_revenue: v.target_revenue || 0, commission_pct: v.commission_pct || 0, email: v.email || null };
            await saveBranch(row, isNew);
            toast.success(isNew ? 'Branch added' : 'Branch updated');
            setEdit(null);
            load();
            syncFromDb().catch(() => {});
          } catch (e) { toast.error(e.message.includes('duplicate') ? 'A branch with this ID or code already exists' : e.message); }
        }}
      />
    </div>
  );
}
