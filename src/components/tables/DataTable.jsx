// Generic list view: search, filters, date range, sort, column toggle, pagination,
// row selection with bulk actions, and CSV/Excel/PDF export of the filtered rows.
import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Columns3, Download, Search, X } from 'lucide-react';
import { DateRangePicker, EmptyState, Skeleton, inRange } from '../ui/index.jsx';
import { useFakeLoad, useCan } from '../../hooks/useApp.js';
import { exportCSV, exportPDF, exportXLSX } from '../../utils/export.js';
import { toast } from '../../store/uiStore.js';

const getValue = (col, row) => (col.value ? col.value(row) : row[col.key]);

/**
 * columns: [{ key, header, value?(row), render?(row), sortable?, hidden?, align?, export? }]
 * filters: [{ key, label, options:[string|{value,label}], match?(row, value) }]
 */
export default function DataTable({
  columns, data, rowKey = 'id', title, exportName, searchPlaceholder = 'Search...', filters = [], dateKey,
  selectable = false, bulkActions, onRowClick, pageSize: initialPageSize = 10, toolbar, emptyTitle, emptyMessage, emptyAction,
  rowClass, initialFilters, hideSearch, exportModule,
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(initialFilters || {});
  const [range, setRange] = useState({ from: '', to: '' });
  const [sort, setSort] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [hidden, setHidden] = useState(() => new Set(columns.filter((c) => c.hidden).map((c) => c.key)));
  const [selected, setSelected] = useState(new Set());
  const [colsOpen, setColsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const loading = useFakeLoad();
  const can = useCan();
  const colsRef = useRef(null);
  const exportRef = useRef(null);

  // Close popovers on outside click.
  useEffect(() => {
    const onDown = (e) => {
      if (!colsRef.current?.contains(e.target)) setColsOpen(false);
      if (!exportRef.current?.contains(e.target)) setExportOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const visible = columns.filter((c) => !hidden.has(c.key));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = data;
    if (q) {
      rows = rows.filter((r) => columns.some((c) => {
        const v = getValue(c, r);
        return (typeof v === 'string' || typeof v === 'number') && String(v).toLowerCase().includes(q);
      }));
    }
    filters.forEach((f) => {
      const v = active[f.key];
      if (v === undefined || v === '') return;
      rows = rows.filter((r) => (f.match ? f.match(r, v) : String(r[f.key]) === String(v)));
    });
    if (dateKey && (range.from || range.to)) rows = rows.filter((r) => inRange(r[dateKey], range));
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      rows = [...rows].sort((a, b) => {
        const av = getValue(col, a);
        const bv = getValue(col, b);
        const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true });
        return sort.dir === 'asc' ? cmp : -cmp;
      });
    }
    return rows;
  }, [data, query, active, range, sort, columns, filters, dateKey]);

  const pages = Math.max(Math.ceil(filtered.length / pageSize), 1);
  const current = Math.min(page, pages);
  const rows = filtered.slice((current - 1) * pageSize, current * pageSize);

  // Reset to the first page whenever the result set changes shape.
  useEffect(() => { setPage(1); }, [query, active, range, pageSize]);
  // Selection can only hold rows that still exist (e.g. after delete or scope change).
  useEffect(() => {
    setSelected((prev) => {
      if (!prev.size) return prev;
      const ids = new Set(data.map((r) => r[rowKey]));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [data, rowKey]);

  const pageIds = rows.map((r) => r[rowKey]);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const togglePage = () => setSelected((prev) => {
    const next = new Set(prev);
    pageIds.forEach((id) => (allOnPage ? next.delete(id) : next.add(id)));
    return next;
  });
  const toggleRow = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleSort = (key) => setSort((s) => {
    if (s?.key !== key) return { key, dir: 'asc' };
    return s.dir === 'asc' ? { key, dir: 'desc' } : null;
  });

  const runExport = async (kind) => {
    setExportOpen(false);
    // Export the selection if there is one, otherwise everything the filters match.
    const source = selected.size ? filtered.filter((r) => selected.has(r[rowKey])) : filtered;
    if (!source.length) { toast.error('Nothing to export'); return; }
    const cols = visible.filter((c) => c.export !== false).map((c) => ({
      header: c.header,
      value: (r) => {
        const v = c.exportValue ? c.exportValue(r) : getValue(c, r);
        return typeof v === 'object' ? '' : v;
      },
    }));
    const name = exportName || title || 'export';
    try {
      if (kind === 'csv') exportCSV(source, cols, name);
      if (kind === 'xlsx') await exportXLSX(source, cols, name);
      if (kind === 'pdf') await exportPDF(source, cols, name, title || name);
      toast.success(`Exported ${source.length} rows to ${kind.toUpperCase()}`);
    } catch (e) {
      toast.error(`Export failed: ${e.message}`);
    }
  };

  const filterCount = Object.values(active).filter((v) => v !== '' && v !== undefined).length + (range.from || range.to ? 1 : 0) + (query ? 1 : 0);
  const selectedRows = selected.size ? data.filter((r) => selected.has(r[rowKey])) : [];
  const canExport = !exportModule || can(exportModule, 'export');

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        {title && <h2 className="me-2 text-sm font-semibold">{title}</h2>}
        {!hideSearch && (
          <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
            <Search size={15} className="absolute start-2.5 top-2.5 text-gray-400" aria-hidden />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={searchPlaceholder} aria-label="Search table" className="input !py-1.5 !ps-8" />
          </div>
        )}
        {toolbar}
        <div className="ms-auto flex items-center gap-2">
          <div className="relative" ref={colsRef}>
            <button type="button" className="btn-outline btn-sm" onClick={() => setColsOpen((o) => !o)} aria-expanded={colsOpen}><Columns3 size={14} aria-hidden /> Columns</button>
            {colsOpen && (
              <div className="absolute end-0 z-20 mt-1 max-h-72 w-52 overflow-y-auto rounded-lg border border-line bg-white p-2 shadow-pop">
                {columns.map((c) => (
                  <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface">
                    <input
                      type="checkbox"
                      className="accent-primary-hover"
                      checked={!hidden.has(c.key)}
                      onChange={() => setHidden((prev) => {
                        const next = new Set(prev);
                        if (next.has(c.key)) next.delete(c.key);
                        else if (visible.length > 1) next.add(c.key);
                        return next;
                      })}
                    />
                    {c.header || c.key}
                  </label>
                ))}
              </div>
            )}
          </div>
          {canExport && (
            <div className="relative" ref={exportRef}>
              <button type="button" className="btn-outline btn-sm" onClick={() => setExportOpen((o) => !o)} aria-expanded={exportOpen}><Download size={14} aria-hidden /> Export</button>
              {exportOpen && (
                <div className="absolute end-0 z-20 mt-1 w-36 rounded-lg border border-line bg-white p-1 shadow-pop">
                  {[['csv', 'CSV'], ['xlsx', 'Excel'], ['pdf', 'PDF']].map(([k, l]) => (
                    <button key={k} type="button" className="block w-full rounded px-3 py-1.5 text-start text-sm hover:bg-surface" onClick={() => runExport(k)}>{l}</button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {(filters.length > 0 || dateKey) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2">
          {filters.map((f) => (
            <select
              key={f.key}
              aria-label={f.label}
              className="input !w-auto !py-1.5 !text-xs"
              value={active[f.key] ?? ''}
              onChange={(e) => setActive((a) => ({ ...a, [f.key]: e.target.value }))}
            >
              <option value="">{f.label}: All</option>
              {f.options.map((o) => {
                const opt = typeof o === 'string' ? { value: o, label: o } : o;
                return <option key={opt.value} value={opt.value}>{opt.label}</option>;
              })}
            </select>
          ))}
          {dateKey && <DateRangePicker value={range} onChange={setRange} />}
          {filterCount > 0 && (
            <button type="button" className="btn-ghost btn-sm" onClick={() => { setActive({}); setRange({ from: '', to: '' }); setQuery(''); }}>
              <X size={13} aria-hidden /> Reset
            </button>
          )}
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-primary bg-primary-light px-3 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          {bulkActions?.(selectedRows, () => setSelected(new Set()))}
          <button type="button" className="btn-ghost btn-sm ms-auto" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      <div className="scroll-thin overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface text-xs text-ink-muted">
            <tr>
              {selectable && (
                <th className="w-10 px-3 py-2.5 text-start">
                  <input type="checkbox" className="accent-primary-hover" aria-label="Select all on this page" checked={allOnPage} onChange={togglePage} />
                </th>
              )}
              {visible.map((c) => {
                const sortable = c.sortable !== false && c.header;
                const dir = sort?.key === c.key ? sort.dir : null;
                return (
                  <th key={c.key} scope="col" aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined} className={clsx('whitespace-nowrap px-3 py-2.5 font-medium', c.align === 'right' ? 'text-end' : 'text-start')}>
                    {sortable ? (
                      <button type="button" onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-1 hover:text-ink">
                        {c.header}
                        {dir === 'asc' && <ArrowUp size={12} aria-hidden />}
                        {dir === 'desc' && <ArrowDown size={12} aria-hidden />}
                        {!dir && <ChevronsUpDown size={12} className="opacity-40" aria-hidden />}
                      </button>
                    ) : c.header}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading && Array.from({ length: Math.min(pageSize, 6) }, (_, i) => (
              <tr key={i} className="border-t border-line">
                {selectable && <td className="px-3 py-3"><Skeleton className="h-4 w-4" /></td>}
                {visible.map((c) => <td key={c.key} className="px-3 py-3"><Skeleton className="h-4 w-full max-w-[120px]" /></td>)}
              </tr>
            ))}
            {!loading && rows.map((r) => {
              const id = r[rowKey];
              return (
                <tr
                  key={id}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  className={clsx('border-t border-line', onRowClick && 'cursor-pointer hover:bg-surface', selected.has(id) && 'bg-primary-light/50', rowClass?.(r))}
                >
                  {selectable && (
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" className="accent-primary-hover" aria-label={`Select ${id}`} checked={selected.has(id)} onChange={() => toggleRow(id)} />
                    </td>
                  )}
                  {visible.map((c) => (
                    <td key={c.key} className={clsx('whitespace-nowrap px-3 py-2.5', c.align === 'right' && 'text-end tabular-nums', c.className)}>
                      {c.render ? c.render(r) : (getValue(c, r) ?? '-')}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && !rows.length && (
          <EmptyState
            title={emptyTitle || (filterCount ? 'No matching records' : 'Nothing here yet')}
            message={emptyMessage || (filterCount ? 'Try clearing a filter or changing the search.' : undefined)}
            action={emptyAction}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2 text-xs text-ink-muted">
        <div className="flex items-center gap-2">
          <span>{filtered.length ? `${(current - 1) * pageSize + 1}-${Math.min(current * pageSize, filtered.length)} of ${filtered.length}` : '0 records'}</span>
          <select aria-label="Rows per page" className="input !w-auto !py-1 !text-xs" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
            {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className="btn-outline btn-sm" disabled={current <= 1} onClick={() => setPage(current - 1)} aria-label="Previous page"><ChevronLeft size={14} className="rtl-flip" /></button>
          <span className="px-2">Page {current} of {pages}</span>
          <button type="button" className="btn-outline btn-sm" disabled={current >= pages} onClick={() => setPage(current + 1)} aria-label="Next page"><ChevronRight size={14} className="rtl-flip" /></button>
        </div>
      </div>
    </div>
  );
}
