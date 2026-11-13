// Hub operations: barcode scan simulation and manifest (bag) management.
import { useMemo, useRef, useState } from 'react';

import clsx from 'clsx';
import { CheckCircle2, ScanLine, XCircle } from 'lucide-react';
import DataTable from '../../components/tables/DataTable.jsx';
import { Card, PageHeader } from '../../components/ui/index.jsx';

import { useData } from '../../store/dataStore.js';
import { toast } from '../../store/uiStore.js';

import { STATUS } from '../../utils/status.js';
import { uid } from '../../utils/format.js';

// What a hub-in or hub-out scan means for a parcel in each state.
const HUB_IN = { [STATUS.PICKED]: STATUS.ORIGIN, [STATUS.TRANSIT]: STATUS.DEST };
const HUB_OUT = { [STATUS.ORIGIN]: STATUS.TRANSIT, [STATUS.DEST]: STATUS.OFD };

export function ParcelScan() {
  const { shipments, changeStatus } = useData();
  const [mode, setMode] = useState('in');
  const [code, setCode] = useState('');
  const [log, setLog] = useState([]);
  const input = useRef(null);

  const samples = useMemo(() => {
    const map = mode === 'in' ? HUB_IN : HUB_OUT;
    return shipments.filter((s) => map[s.status]).slice(0, 4).map((s) => s.awb);
  }, [shipments, mode]);

  const scan = async (raw) => {
    const awb = raw.trim().toUpperCase();
    if (!awb) return;
    const s = shipments.find((x) => x.awb === awb);
    const at = new Date().toISOString();
    const entry = { id: uid('SC'), awb, at, mode };
    if (!s) {
      setLog((l) => [{ ...entry, ok: false, message: 'Not found in the system' }, ...l]);
      toast.error(`${awb} not found`);
    } else {
      const target = (mode === 'in' ? HUB_IN : HUB_OUT)[s.status];
      // Dispatching for delivery needs a rider, otherwise the parcel has no owner.
      if (target === STATUS.OFD && !s.riderId) {
        setLog((l) => [{ ...entry, ok: false, message: 'Assign a rider before scanning out' }, ...l]);
        toast.error(`${awb}: assign a rider first`);
      } else if (!target) {
        setLog((l) => [{ ...entry, ok: false, message: `Wrong scan: parcel is "${s.status}"` }, ...l]);
        toast.error(`${awb}: cannot scan ${mode} while ${s.status}`);
      } else {
        try {
          const { ok } = await changeStatus(s.id, target, { note: `Scanned ${mode === 'in' ? 'in at' : 'out of'} hub` });
          setLog((l) => [{ ...entry, ok, message: ok ? `${s.status} -> ${target}` : 'Not allowed for your role or branch', id2: s.id }, ...l]);
          toast[ok ? 'success' : 'error'](ok ? `${awb}: ${target}` : `${awb}: not allowed`);
        } catch (e) {
          setLog((l) => [{ ...entry, ok: false, message: e.message }, ...l]);
          toast.error(e.message);
        }
      }
    }
    setCode('');
    input.current?.focus();
  };

  const okCount = log.filter((l) => l.ok).length;
  return (
    <div>
      <PageHeader title="Parcel Scan" subtitle="Scan or type an AWB and press Enter. A USB barcode scanner works the same way." />
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card title="Scanner">
          <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1">
            {[['in', 'Hub In'], ['out', 'Hub Out']].map(([m, label]) => (
              <button key={m} type="button" aria-pressed={mode === m} className={clsx('rounded-md py-2 text-sm font-semibold', mode === m ? 'bg-primary' : 'text-ink-muted')} onClick={() => { setMode(m); input.current?.focus(); }}>{label}</button>
            ))}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); scan(code); }}>
            <div className="relative">
              <ScanLine size={18} className="absolute start-3 top-3 text-ink-muted" aria-hidden />
              <input ref={input} autoFocus aria-label="AWB barcode" value={code} onChange={(e) => setCode(e.target.value)} placeholder="SLX100001" className="input !py-2.5 !ps-10 font-mono text-base" />
            </div>
            <button type="submit" className="btn-primary mt-2 w-full" disabled={!code.trim()}>Scan</button>
          </form>
          <p className="mb-1 mt-4 text-xs font-medium text-ink-muted">Try a parcel ready for {mode === 'in' ? 'Hub In' : 'Hub Out'}:</p>
          <div className="flex flex-wrap gap-1.5">
            {samples.map((a) => <button key={a} type="button" className="chip hover:bg-primary-light" onClick={() => scan(a)}>{a}</button>)}
            {!samples.length && <span className="text-xs text-ink-muted">None right now</span>}
          </div>
        </Card>
        <Card title={`Session log (${okCount} ok, ${log.length - okCount} errors)`} className="lg:col-span-2" bodyClass="" actions={log.length > 0 && <button type="button" className="btn-ghost btn-sm" onClick={() => setLog([])}>Clear</button>}>
          {!log.length && <p className="px-4 py-12 text-center text-sm text-ink-muted">Scans from this session appear here.</p>}
          <ul className="scroll-thin max-h-[420px] divide-y divide-line overflow-y-auto">
            {log.map((l) => (
              <li key={l.id} className={clsx('flex items-center gap-3 px-4 py-2.5 text-sm', !l.ok && 'bg-danger-light/50')}>
                {l.ok ? <CheckCircle2 size={17} className="shrink-0 text-primary-dark" aria-hidden /> : <XCircle size={17} className="shrink-0 text-danger" aria-hidden />}
                <span className="font-mono font-semibold">{l.awb}</span>
                <span className={clsx('min-w-0 flex-1 truncate', !l.ok && 'text-danger-dark')}>{l.message}</span>
                <span className="text-xs text-ink-muted">{new Date(l.at).toLocaleTimeString()}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

