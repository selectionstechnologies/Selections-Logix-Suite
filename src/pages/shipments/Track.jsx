// Public tracking page: no login. Deliberately hides merchant, money and full phone details.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PackageSearch, Search } from 'lucide-react';
import { Logo } from '../../components/layout/AppLayout.jsx';
import { EmptyState, StatusBadge, Stepper, Timeline } from '../../components/ui/index.jsx';
import { useData } from '../../store/dataStore.js';
import { trackShipment } from '../../lib/api.js';
import { HAPPY_PATH } from '../../utils/status.js';
import { serviceLabel } from '../../utils/pricing.js';
import { fmtDate } from '../../utils/format.js';

export default function Track() {
  const { awb } = useParams();
  const navigate = useNavigate();
  const shipments = useData((s) => s.shipments);
  const [code, setCode] = useState(awb || '');
  useEffect(() => { setCode(awb || ''); }, [awb]);
  // Signed-in staff already have the parcel loaded; anyone else asks the server (public, no login).
  const local = awb ? shipments.find((x) => x.awb === awb.trim().toUpperCase()) : null;
  const [remote, setRemote] = useState({ awb: null, shipment: null, loading: false });
  useEffect(() => {
    if (!awb || local) return undefined;
    let live = true;
    setRemote({ awb, shipment: null, loading: true });
    trackShipment(awb).then((sh) => { if (live) setRemote({ awb, shipment: sh, loading: false }); })
      .catch(() => { if (live) setRemote({ awb, shipment: null, loading: false }); });
    return () => { live = false; };
  }, [awb, local]);
  const s = local || (remote.awb === awb ? remote.shipment : null);
  const loading = !local && remote.loading;

  const stepIdx = s ? HAPPY_PATH.indexOf(s.status) : -1;
  const lastHappy = s ? (stepIdx >= 0 ? stepIdx : [...s.events].reverse().map((e) => HAPPY_PATH.indexOf(e.status)).find((i) => i >= 0) ?? 0) : 0;

  return (
    <div className="min-h-screen bg-surface">
      <header className="flex items-center justify-between border-b border-line bg-white px-4 py-3">
        <Link to="/"><Logo /></Link>
      </header>
      <main className="mx-auto max-w-2xl p-4">
        <h1 className="mb-3 mt-4 text-center text-2xl font-bold">Track your shipment</h1>
        <form className="mb-5 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (code.trim()) navigate(`/track/${code.trim().toUpperCase()}`); }}>
          <input aria-label="Enter tracking number" className="input font-mono" placeholder="Enter tracking number" value={code} onChange={(e) => setCode(e.target.value)} />
          <button type="submit" className="btn-primary"><Search size={15} aria-hidden /> Track</button>
        </form>

        {awb && loading && <div className="card p-8 text-center text-sm text-ink-muted" role="status">Looking up {awb.toUpperCase()}...</div>}
        {awb && !s && !loading && <div className="card"><EmptyState icon={PackageSearch} title="Tracking number not found" message={`${awb.toUpperCase()}: please check the number and try again.`} /></div>}
        {!awb && <div className="card"><EmptyState icon={PackageSearch} title="Enter tracking number" message="Your tracking number starts with SLX and is printed on the label." /></div>}

        {s && (
          <div className="space-y-4">
            <section className="card p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="font-mono text-lg font-bold">{s.awb}</p>
                <StatusBadge status={s.status} />
              </div>
              <Stepper steps={HAPPY_PATH.map(t)} current={s.status === 'Delivered' ? HAPPY_PATH.length : stepIdx < 0 ? lastHappy + 1 : lastHappy} failed={stepIdx < 0} />
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div><dt className="text-xs text-ink-muted">From</dt><dd className="font-medium">{s.originCity}</dd></div>
                <div><dt className="text-xs text-ink-muted">To</dt><dd className="font-medium">{s.destCity}</dd></div>
                <div><dt className="text-xs text-ink-muted">Service</dt><dd className="font-medium">{serviceLabel(s.service)}</dd></div>
                <div><dt className="text-xs text-ink-muted">Estimated delivery</dt><dd className="font-medium">{fmtDate(s.eta)}</dd></div>
              </dl>
            </section>
            <section className="card p-4">
              <h2 className="mb-3 text-sm font-semibold">Tracking history</h2>
              <Timeline events={s.events.map((e) => ({ status: e.status, at: e.at, location: e.location }))} />
            </section>
          </div>
        )}
        <p className="mt-8 text-center text-xs text-ink-muted">Selections Logix Suite - Ship. Collect. Control.</p>
      </main>
    </div>
  );
}
