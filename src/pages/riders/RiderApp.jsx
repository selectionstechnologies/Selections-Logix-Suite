// Mobile-first rider view: today's pickups and deliveries, proof of delivery, cash deposit.
import { useRef, useState } from 'react';
import clsx from 'clsx';
import { Banknote, Camera, CheckCircle2, Eye, KeyRound, MapPin, PackageOpen, PenLine, Phone, Truck, Wallet, XCircle } from 'lucide-react';
import { EmptyState, Modal, StatusBadge, Tabs } from '../../components/ui/index.jsx';
import { useAuth } from '../../store/authStore.js';
import { useData } from '../../store/dataStore.js';
import { toast } from '../../store/uiStore.js';
import { NDR_REASONS, STATUS } from '../../utils/status.js';
import { fmtCurrency, sum } from '../../utils/format.js';

function SignaturePad({ onChange }) {
  const canvas = useRef(null);
  const drawing = useRef(false);
  const pos = (e) => {
    const r = canvas.current.getBoundingClientRect();
    return [(e.clientX - r.left) * (canvas.current.width / r.width), (e.clientY - r.top) * (canvas.current.height / r.height)];
  };
  const start = (e) => {
    drawing.current = true;
    canvas.current.setPointerCapture(e.pointerId);
    const ctx = canvas.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(...pos(e));
  };
  const move = (e) => {
    if (!drawing.current) return;
    const ctx = canvas.current.getContext('2d');
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineTo(...pos(e));
    ctx.stroke();
    onChange(true);
  };
  const clear = () => {
    canvas.current.getContext('2d').clearRect(0, 0, canvas.current.width, canvas.current.height);
    onChange(false);
  };
  return (
    <div>
      <canvas ref={canvas} width={480} height={160} className="h-32 w-full touch-none rounded-lg border border-dashed border-gray-400 bg-surface" onPointerDown={start} onPointerMove={move} onPointerUp={() => { drawing.current = false; }} aria-label="Signature pad" />
      <button type="button" className="mt-1 text-xs text-ink-muted hover:text-ink" onClick={clear}>Clear signature</button>
    </div>
  );
}

/** Demo OTP derived from the AWB, shown on screen because nothing is really sent. */
const demoOtp = (awb) => awb.slice(-4);

function DeliverModal({ shipment: s, onClose }) {
  const changeStatus = useData((st) => st.changeStatus);
  const [method, setMethod] = useState('OTP');
  const [otp, setOtp] = useState('');
  const [signed, setSigned] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [cash, setCash] = useState(false);
  const [toPayCash, setToPayCash] = useState(false);
  const [receivedBy, setReceivedBy] = useState(s.receiver.name);

  const proofOk = method === 'OTP' ? otp === demoOtp(s.awb) : method === 'Signature' ? signed : !!photo;
  const needsCash = s.cod > 0;
  const needsToPay = s.toPay > 0;
  const canSubmit = proofOk && (!needsCash || cash) && (!needsToPay || toPayCash) && receivedBy.trim();
  const submit = () => {
    const { ok } = changeStatus(s.id, STATUS.DELIVERED, { method, receivedBy: receivedBy.trim(), note: `Delivered to ${receivedBy.trim()} (${method})` });
    if (ok) toast.success(`${s.awb} delivered${needsCash ? `, ${fmtCurrency(s.cod, s.currency)} collected` : ''}`);
    else toast.error('This parcel is not out for delivery');
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Deliver ${s.awb}`}
      footer={<><button type="button" className="btn-outline" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" disabled={!canSubmit} onClick={submit}><CheckCircle2 size={15} aria-hidden /> Confirm delivery</button></>}
    >
      <div className="space-y-3">
        <div>
          <label htmlFor="rb" className="label">Received by</label>
          <input id="rb" className="input" value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} />
        </div>
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-gray-100 p-1">
          {[['OTP', KeyRound], ['Signature', PenLine], ['Photo', Camera]].map(([m, Icon]) => (
            <button key={m} type="button" aria-pressed={method === m} className={clsx('flex items-center justify-center gap-1 rounded-md py-2 text-xs font-semibold', method === m ? 'bg-primary' : 'text-ink-muted')} onClick={() => setMethod(m)}><Icon size={13} aria-hidden /> {m}</button>
          ))}
        </div>
        {method === 'OTP' && (
          <div>
            <label htmlFor="otp" className="label">Customer OTP</label>
            <input id="otp" inputMode="numeric" maxLength={4} className={clsx('input text-center font-mono text-lg tracking-[0.4em]', otp.length === 4 && otp !== demoOtp(s.awb) && 'input-error')} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} />
            {otp.length === 4 && otp !== demoOtp(s.awb) && <p role="alert" className="mt-1 text-xs font-medium text-danger">That OTP does not match</p>}
            <p className="mt-1 text-xs text-ink-muted">Demo OTP: {demoOtp(s.awb)}</p>
          </div>
        )}
        {method === 'Signature' && <SignaturePad onChange={setSigned} />}
        {method === 'Photo' && (
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-gray-400 p-4 text-sm">
            {photo ? <img src={photo} alt="Proof of delivery" className="max-h-40 rounded" /> : <Camera size={24} className="text-ink-muted" aria-hidden />}
            {photo ? 'Replace photo' : 'Take or choose a photo'}
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) setPhoto(URL.createObjectURL(f)); }} />
          </label>
        )}
        {needsCash && (
          <label className={clsx('flex items-center gap-3 rounded-lg border-2 p-3', cash ? 'border-primary-hover bg-primary-light' : 'border-danger bg-danger-light')}>
            <input type="checkbox" className="h-5 w-5 accent-primary-hover" checked={cash} onChange={(e) => setCash(e.target.checked)} />
            <span className="text-sm font-bold">Collected COD: <span className="text-danger-dark">{fmtCurrency(s.cod, s.currency)}</span></span>
          </label>
        )}
        {needsToPay && (
          <label className={clsx('flex items-center gap-3 rounded-lg border-2 p-3', toPayCash ? 'border-primary-hover bg-primary-light' : 'border-danger bg-danger-light')}>
            <input type="checkbox" className="h-5 w-5 accent-primary-hover" checked={toPayCash} onChange={(e) => setToPayCash(e.target.checked)} />
            <span className="text-sm font-bold">Collected delivery charges (To Pay): <span className="text-danger-dark">{fmtCurrency(s.toPay, s.currency)}</span></span>
          </label>
        )}
      </div>
    </Modal>
  );
}

function FailModal({ shipment: s, onClose }) {
  const changeStatus = useData((st) => st.changeStatus);
  const [reason, setReason] = useState('');
  const submit = () => {
    const { ok } = changeStatus(s.id, STATUS.FAILED, { reason, note: reason });
    toast[ok ? 'info' : 'error'](ok ? `${s.awb} marked failed: ${reason}` : 'This parcel is not out for delivery');
    onClose();
  };
  return (
    <Modal open onClose={onClose} title={`Failed attempt: ${s.awb}`} footer={<><button type="button" className="btn-outline" onClick={onClose}>Cancel</button><button type="button" className="btn-danger" disabled={!reason} onClick={submit}>Mark failed</button></>}>
      <fieldset className="space-y-1.5">
        <legend className="label">Reason</legend>
        {NDR_REASONS.map((r) => (
          <label key={r} className={clsx('flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-sm', reason === r ? 'border-danger bg-danger-light' : 'border-line')}>
            <input type="radio" name="reason" className="accent-danger" checked={reason === r} onChange={() => setReason(r)} /> {r}
          </label>
        ))}
      </fieldset>
    </Modal>
  );
}

function DepositModal({ rider, cash, onClose }) {
  const recordDeposit = useData((s) => s.recordDeposit);
  const [amount, setAmount] = useState(String(cash));
  const value = Number(amount);
  const valid = amount !== '' && value >= 0;
  const diff = valid ? value - cash : 0;
  const submit = () => {
    const dep = recordDeposit(rider.id, value);
    if (dep) toast.success(`Deposit of ${fmtCurrency(value, rider.currency)} sent for reconciliation`);
    onClose();
  };
  return (
    <Modal open onClose={onClose} title="Daily cash deposit" size="sm" footer={<><button type="button" className="btn-outline" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" disabled={!valid} onClick={submit}>Submit deposit</button></>}>
      <p className="mb-3 text-sm">Expected from collected COD: <b>{fmtCurrency(cash, rider.currency)}</b></p>
      <label htmlFor="dep" className="label">Amount handed in ({rider.currency})</label>
      <input id="dep" type="number" min="0" inputMode="decimal" className="input text-lg font-semibold" value={amount} onChange={(e) => setAmount(e.target.value)} />
      {valid && diff !== 0 && <p role="alert" className="mt-2 rounded-lg bg-danger-light px-3 py-2 text-sm font-medium text-danger-dark">{diff < 0 ? 'Shortage' : 'Excess'} of {fmtCurrency(Math.abs(diff), rider.currency)}. The accountant will review this.</p>}
    </Modal>
  );
}

function StopCard({ s, kind, onDeliver, onFail, onPicked }) {
  const person = kind === 'pickup' ? s.sender : s.receiver;
  const phone = person.phone.replace(/\s/g, '');
  const map = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${person.address}, ${person.city}`)}`;
  return (
    <li className="card p-3.5">
      <div className="mb-1 flex items-start justify-between gap-2">
        <span className="font-mono text-xs text-ink-muted">{s.awb}</span>
        <StatusBadge status={s.status} />
      </div>
      <p className="font-semibold">{person.name}</p>
      <p className="text-sm text-gray-700">{person.address}, {person.city}</p>
      {kind === 'delivery' && s.cod > 0 && <p className="mt-1 text-base font-black text-danger">COD {fmtCurrency(s.cod, s.currency)}</p>}
      {kind === 'delivery' && s.toPay > 0 && <p className="mt-1 text-base font-black text-danger">TO PAY {fmtCurrency(s.toPay, s.currency)}</p>}
      {s.notes && <p className="mt-1 rounded bg-primary-light px-2 py-1 text-xs">{s.notes}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <a href={`tel:${phone}`} className="btn-outline"><Phone size={15} aria-hidden /> Call</a>
        <a href={map} target="_blank" rel="noreferrer" className="btn-outline"><MapPin size={15} aria-hidden /> Map</a>
        {kind === 'delivery' ? (
          <>
            <button type="button" className="btn-primary" onClick={() => onDeliver(s)} disabled={s.status !== STATUS.OFD}><CheckCircle2 size={15} aria-hidden /> Mark delivered</button>
            <button type="button" className="btn-danger" onClick={() => onFail(s)} disabled={s.status !== STATUS.OFD}><XCircle size={15} aria-hidden /> Mark failed</button>
          </>
        ) : (
          <button type="button" className="btn-primary col-span-2" onClick={() => onPicked(s)}><PackageOpen size={15} aria-hidden /> Picked up</button>
        )}
      </div>
    </li>
  );
}

export function RiderApp() {
  const user = useAuth((s) => s.user);
  const { riders, shipments, codTransactions, changeStatus } = useData();
  const riderId = user.riderId || riders[0].id;
  const rider = riders.find((r) => r.id === riderId);
  const [tab, setTab] = useState('deliveries');
  const [deliver, setDeliver] = useState(null);
  const [fail, setFail] = useState(null);
  const [deposit, setDeposit] = useState(false);

  const deliveries = shipments.filter((s) => s.riderId === riderId && [STATUS.OFD, STATUS.REATTEMPT].includes(s.status));
  const pickups = shipments.filter((s) => s.pickupRiderId === riderId && s.status === STATUS.BOOKED);
  const cashTxns = codTransactions.filter((x) => x.riderId === riderId && x.status === 'Collected');
  const cash = sum(cashTxns, (x) => x.amount);
  const toCollect = sum(deliveries, (s) => s.cod);

  const picked = (s) => {
    const { ok } = changeStatus(s.id, STATUS.PICKED, { note: `Collected by ${rider.name}` });
    toast[ok ? 'success' : 'error'](ok ? `${s.awb} picked up` : 'Could not update this parcel');
  };

  return (
    <div className="mx-auto max-w-md">
      {user.role !== 'rider' && <p className="mb-3 flex items-center gap-2 rounded-lg bg-primary-light px-3 py-2 text-sm"><Eye size={15} aria-hidden /> Previewing the rider app as {rider.name}.</p>}
      <section className="mb-3 rounded-xl bg-primary p-4">
        <p className="text-xs font-medium">{rider.zone}</p>
        <h1 className="text-lg font-bold">{rider.name}</h1>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-white/70 p-2"><p className="text-lg font-black">{deliveries.length}</p><p className="text-[11px]">Deliveries</p></div>
          <div className="rounded-lg bg-white/70 p-2"><p className="text-lg font-black">{pickups.length}</p><p className="text-[11px]">Pickups</p></div>
          <div className="rounded-lg bg-white/70 p-2"><p className="truncate text-sm font-black leading-7">{toCollect.toLocaleString('en-US')}</p><p className="text-[11px]">To collect</p></div>
        </div>
      </section>
      <section className="card mb-3 flex items-center justify-between gap-3 p-3.5">
        <div className="flex items-center gap-2.5">
          <span className="rounded-lg bg-danger-light p-2 text-danger"><Wallet size={18} aria-hidden /></span>
          <div>
            <p className="text-xs text-ink-muted">Cash in hand ({cashTxns.length} parcels)</p>
            <p className="font-black text-danger">{fmtCurrency(cash, rider.currency)}</p>
          </div>
        </div>
        <button type="button" className="btn-primary" disabled={!cash} onClick={() => setDeposit(true)}><Banknote size={15} aria-hidden /> Deposit cash</button>
      </section>
      <Tabs tabs={[{ value: 'deliveries', label: 'Deliveries', count: deliveries.length }, { value: 'pickups', label: 'Pickups', count: pickups.length }]} value={tab} onChange={setTab} />
      <ul className="space-y-3">
        {tab === 'deliveries' && deliveries.map((s) => <StopCard key={s.id} s={s} kind="delivery" onDeliver={setDeliver} onFail={setFail} />)}
        {tab === 'pickups' && pickups.map((s) => <StopCard key={s.id} s={s} kind="pickup" onPicked={picked} />)}
      </ul>
      {tab === 'deliveries' && !deliveries.length && <div className="card"><EmptyState icon={Truck} title="All deliveries done" message="New parcels show up here once the branch assigns them." /></div>}
      {tab === 'pickups' && !pickups.length && <div className="card"><EmptyState icon={PackageOpen} title="No pickups assigned" /></div>}
      {deliver && <DeliverModal shipment={deliver} onClose={() => setDeliver(null)} />}
      {fail && <FailModal shipment={fail} onClose={() => setFail(null)} />}
      {deposit && <DepositModal rider={rider} cash={cash} onClose={() => setDeposit(false)} />}
    </div>
  );
}
