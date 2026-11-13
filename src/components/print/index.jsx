// Print pipeline and all printable documents. PrintPreview shows the document on screen and
// mirrors it into #print-root, the only thing visible under @media print (see index.css).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Printer } from 'lucide-react';
import Barcode from 'react-barcode';
import { QRCodeSVG } from 'qrcode.react';
import clsx from 'clsx';
import { Modal } from '../ui/index.jsx';
import { useData } from '../../store/dataStore.js';
import { toast } from '../../store/uiStore.js';
import { elementToPDF } from '../../utils/export.js';
import { CITY_MAP } from '../../data/geo.js';
import { fmtCurrency, fmtDate, fmtDateTime } from '../../utils/format.js';
import { serviceLabel } from '../../utils/pricing.js';

export const PAGE_SIZES = {
  a4: { label: 'A4', width: '210mm', height: '297mm', page: 'A4' },
  a5: { label: 'A5', width: '148mm', height: '210mm', page: 'A5' },
  '4x6': { label: '4x6 Thermal', width: '101.6mm', height: '152.4mm', page: '101.6mm 152.4mm' },
};

export function PrintPreview({ open, onClose, title, filename = 'document', size = 'a4', children, onPrint, extraActions }) {
  const previewRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const printRoot = document.getElementById('print-root');

  // A per-document @page rule so a thermal label does not print on an A4 sheet.
  useEffect(() => {
    if (!open) return undefined;
    const style = document.createElement('style');
    style.textContent = `@page { size: ${PAGE_SIZES[size]?.page || 'A4'}; margin: 0; }`;
    document.head.appendChild(style);
    return () => style.remove();
  }, [open, size]);

  const print = () => {
    onPrint?.();
    window.print();
  };
  const pdf = async () => {
    setBusy(true);
    try {
      await elementToPDF(previewRef.current, filename);
      onPrint?.();
      toast.success(`Saved ${filename}.pdf`);
    } catch (e) {
      toast.error(`Could not create PDF: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={title}
        size="xl"
        footer={(
          <>
            {extraActions}
            <button type="button" className="btn-outline" onClick={onClose}>Close</button>
            <button type="button" className="btn-outline" onClick={pdf} disabled={busy}><Download size={15} aria-hidden /> {busy ? 'Creating...' : 'Download PDF'}</button>
            <button type="button" className="btn-primary" onClick={print} data-autofocus><Printer size={15} aria-hidden /> Print</button>
          </>
        )}
      >
        <div className="overflow-auto rounded-lg bg-gray-100 p-4">
          <div ref={previewRef} className="mx-auto flex w-fit flex-col gap-4 bg-gray-100">{children}</div>
        </div>
      </Modal>
      {open && printRoot && createPortal(<div>{children}</div>, printRoot)}
    </>
  );
}

/** A fixed-size sheet. Always light, whatever the app looks like. */
export function Sheet({ size = 'a4', children, className, autoHeight }) {
  const s = PAGE_SIZES[size];
  return (
    <div className={clsx('print-page overflow-hidden bg-white text-[#111827] shadow-card print:shadow-none', className)} style={{ width: s.width, [autoHeight ? 'minHeight' : 'height']: s.height }}>
      {children}
    </div>
  );
}

const Brand = ({ small }) => {
  const settings = useData((s) => s.settings);
  return (
    <div className="flex items-center gap-2">
      {settings.logo
        ? <img src={settings.logo} alt="" className={small ? 'h-6 w-6 object-contain' : 'h-9 w-9 object-contain'} />
        : (
          <svg viewBox="0 0 32 32" className={small ? 'h-6 w-6' : 'h-9 w-9'} aria-hidden>
            <rect width="32" height="32" rx="8" fill="#DC2626" />
            <path d="M8 11l8-4 8 4v10l-8 4-8-4z" fill="#FACC15" />
          </svg>
        )}
      <div className="leading-tight">
        <p className={clsx('font-bold', small ? 'text-[11px]' : 'text-base')}>{settings.product}</p>
        <p className={clsx('text-gray-500', small ? 'text-[8px]' : 'text-xs')}>{settings.tagline}</p>
      </div>
    </div>
  );
};

const CODE = (city) => CITY_MAP[city]?.code || '---';

export function ShippingLabel({ shipment: s, size = '4x6' }) {
  const small = size === '4x6';
  const url = `${window.location.origin}/track/${s.awb}`;
  const scale = size === 'a4' ? 'text-base' : size === 'a5' ? 'text-sm' : 'text-[11px]';
  const qr = size === 'a4' ? 110 : size === 'a5' ? 88 : 66;
  return (
    <Sheet size={size} className={clsx('flex flex-col p-3', scale, !small && 'p-6')}>
      <div className="flex items-center justify-between border-b-2 border-[#111827] pb-2">
        <Brand small={small} />
        <div className="text-end">
          <p className="font-bold uppercase">{serviceLabel(s.service)}</p>
          <p className="text-gray-600">{fmtDate(s.createdAt)}</p>
        </div>
      </div>
      <div className="flex items-center justify-center gap-3 border-b border-gray-300 py-2 font-black">
        <span className={size === 'a4' ? 'text-5xl' : 'text-3xl'}>{CODE(s.originCity)}</span>
        <span aria-hidden className={size === 'a4' ? 'text-5xl' : 'text-3xl'}>&rarr;</span>
        <span className={size === 'a4' ? 'text-5xl' : 'text-3xl'}>{CODE(s.destCity)}</span>
      </div>
      <div className="flex justify-center border-b border-gray-300 py-1">
        <Barcode value={s.awb} width={small ? 1.5 : 2} height={small ? 44 : 64} fontSize={small ? 12 : 16} margin={2} />
      </div>
      <div className="grid flex-1 grid-cols-[1fr_auto] gap-2 py-2">
        <div className="min-w-0 space-y-2">
          <div>
            <p className="font-bold uppercase text-gray-500">Deliver to</p>
            <p className="font-bold">{s.receiver.name}</p>
            <p>{s.receiver.address}, {s.receiver.city}</p>
            {s.receiver.zone && <p className="font-semibold">{s.receiver.zone}</p>}
            <p>{s.receiver.phone}</p>
          </div>
          <div>
            <p className="font-bold uppercase text-gray-500">From</p>
            <p className="font-semibold">{s.sender.name}</p>
            <p>{s.sender.address}</p>
            <p>{s.sender.phone}</p>
          </div>
        </div>
        <div className="flex flex-col items-center gap-1">
          <QRCodeSVG value={url} size={qr} />
          <p className="text-center text-gray-500">Scan to track</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1 border-t border-gray-300 pt-2">
        <div><p className="text-gray-500">Weight</p><p className="font-bold">{s.chargeableWeight ?? s.parcel.weight} kg</p></div>
        <div><p className="text-gray-500">Pieces</p><p className="font-bold">{s.pieceNo ? `${s.pieceNo} / ${s.parcel.pieces}` : s.parcel.pieces}</p></div>
        <div><p className="text-gray-500">Ref</p><p className="truncate font-bold">{s.courier.split(' ')[0]}</p></div>
      </div>
      <div className={clsx('mt-2 rounded border-2 py-1.5 text-center font-black', s.cod > 0 || s.toPay > 0 ? 'border-[#DC2626] text-[#DC2626]' : 'border-gray-300 text-gray-700')}>
        <span className={size === 'a4' ? 'text-3xl' : 'text-xl'}>{s.cod > 0 ? `COD ${fmtCurrency(s.cod, s.currency)}` : s.toPay > 0 ? `TO PAY ${fmtCurrency(s.toPay, s.currency)}` : 'PREPAID - NO COD'}</span>
      </div>
    </Sheet>
  );
}

const DocHeader = ({ title, number, date }) => (
  <div className="mb-5 flex items-start justify-between border-b-2 border-[#FACC15] pb-3">
    <Brand />
    <div className="text-end">
      <p className="text-xl font-bold uppercase">{title}</p>
      {number && <p className="text-sm font-semibold">{number}</p>}
      {date && <p className="text-xs text-gray-500">{date}</p>}
    </div>
  </div>
);

const Party = ({ label, p }) => (
  <div className="rounded border border-gray-200 p-3 text-sm">
    <p className="mb-1 text-xs font-bold uppercase text-gray-500">{label}</p>
    <p className="font-semibold">{p.name}</p>
    <p>{p.address}{p.city && !String(p.address).includes(p.city) ? `, ${p.city}` : ''}</p>
    <p>{p.phone}</p>
  </div>
);

const Signature = ({ label }) => (
  <div className="mt-10 w-56 border-t border-gray-400 pt-1 text-xs text-gray-600">{label}</div>
);

export function AirwayBill({ shipment: s }) {
  return (
    <Sheet size="a4" className="p-8">
      <DocHeader title="Airway Bill" number={s.awb} date={fmtDateTime(s.createdAt)} />
      <div className="mb-4 flex justify-center"><Barcode value={s.awb} height={56} width={2} fontSize={14} /></div>
      <div className="mb-4 grid grid-cols-2 gap-3"><Party label="Shipper" p={s.sender} /><Party label="Consignee" p={s.receiver} /></div>
      <table className="mb-4 w-full border-collapse text-sm">
        <thead><tr className="bg-gray-100 text-start text-xs uppercase"><th className="border border-gray-200 p-2 text-start">Service</th><th className="border border-gray-200 p-2 text-start">Route</th><th className="border border-gray-200 p-2 text-start">Pieces</th><th className="border border-gray-200 p-2 text-start">Chargeable wt</th><th className="border border-gray-200 p-2 text-start">Declared value</th></tr></thead>
        <tbody><tr>
          <td className="border border-gray-200 p-2">{serviceLabel(s.service)}</td>
          <td className="border border-gray-200 p-2">{CODE(s.originCity)} to {CODE(s.destCity)}</td>
          <td className="border border-gray-200 p-2">{s.parcel.pieces}</td>
          <td className="border border-gray-200 p-2">{s.chargeableWeight ?? s.parcel.weight} kg</td>
          <td className="border border-gray-200 p-2">{fmtCurrency(s.parcel.declaredValue, s.currency)}</td>
        </tr></tbody>
      </table>
      <p className="mb-1 text-xs font-bold uppercase text-gray-500">Contents</p>
      <ul className="mb-4 text-sm">{s.parcel.items.map((i, idx) => <li key={idx}>{i.qty} x {i.name}</li>)}</ul>
      {s.cod > 0 && <p className="mb-4 text-lg font-black text-[#DC2626]">COD to collect: {fmtCurrency(s.cod, s.currency)}</p>}
      <p className="text-sm">Total charges: <b>{fmtCurrency(s.charges.total, s.currency)}</b></p>
      <div className="flex justify-between"><Signature label="Shipper signature" /><Signature label="Carrier signature" /></div>
    </Sheet>
  );
}

export function DeliveryReceipt({ shipment: s }) {
  return (
    <Sheet size="a5" className="p-6 text-sm">
      <DocHeader title="Proof of Delivery" number={s.awb} />
      <dl className="mb-3 grid grid-cols-2 gap-2">
        <div><dt className="text-xs text-gray-500">Delivered to</dt><dd className="font-semibold">{s.pod?.receivedBy || s.receiver.name}</dd></div>
        <div><dt className="text-xs text-gray-500">Date</dt><dd className="font-semibold">{s.pod ? fmtDateTime(s.pod.at) : 'Not yet delivered'}</dd></div>
        <div><dt className="text-xs text-gray-500">Confirmed by</dt><dd className="font-semibold">{s.pod?.method || '-'}</dd></div>
        <div><dt className="text-xs text-gray-500">COD collected</dt><dd className="font-semibold">{s.cod > 0 ? fmtCurrency(s.cod, s.currency) : 'None'}</dd></div>
      </dl>
      <Party label="Address" p={s.receiver} />
      <p className="mt-3 text-xs text-gray-600">Received the above shipment in good condition.</p>
      <Signature label="Receiver signature" />
    </Sheet>
  );
}

export function PickupReceipt({ shipment: s }) {
  return (
    <Sheet size="a5" className="p-6 text-sm">
      <DocHeader title="Pickup Receipt" number={s.awb} date={fmtDate(s.createdAt)} />
      <Party label="Collected from" p={s.sender} />
      <dl className="my-3 grid grid-cols-2 gap-2">
        <div><dt className="text-xs text-gray-500">Pieces</dt><dd className="font-semibold">{s.parcel.pieces}</dd></div>
        <div><dt className="text-xs text-gray-500">Weight</dt><dd className="font-semibold">{s.parcel.weight} kg</dd></div>
        <div><dt className="text-xs text-gray-500">Destination</dt><dd className="font-semibold">{s.destCity}</dd></div>
        <div><dt className="text-xs text-gray-500">Service</dt><dd className="font-semibold">{serviceLabel(s.service)}</dd></div>
      </dl>
      <div className="flex justify-center"><Barcode value={s.awb} height={40} width={1.5} fontSize={12} /></div>
      <div className="flex justify-between"><Signature label="Sender" /></div>
    </Sheet>
  );
}

export function ReturnSlip({ shipment: s }) {
  return (
    <Sheet size="a5" className="p-6 text-sm">
      <DocHeader title="Return Slip" number={s.awb} date={fmtDate(new Date())} />
      <div className="mb-3 grid grid-cols-2 gap-2"><Party label="Return to" p={s.sender} /><Party label="Original receiver" p={s.receiver} /></div>
      <p className="mb-3"><span className="text-xs text-gray-500">Reason: </span><b className="text-[#DC2626]">{s.ndr?.reason || 'Return requested'}</b></p>
      <div className="flex justify-center"><Barcode value={s.awb} height={40} width={1.5} fontSize={12} /></div>
      <Signature label="Received back by" />
    </Sheet>
  );
}

export function RunSheetDoc({ rider, shipments }) {
  const codTotal = shipments.reduce((a, s) => a + (Number(s.cod) || 0), 0);
  return (
    <Sheet size="a4" autoHeight className="p-8">
      <DocHeader title="Run Sheet" number={rider.name} date={fmtDate(new Date())} />
      <p className="mb-3 text-sm">Zone: <b>{rider.zone}</b> | Vehicle: <b>{rider.vehicle} ({rider.plate})</b> | Stops: <b>{shipments.length}</b></p>
      <table className="w-full border-collapse text-xs">
        <thead><tr className="bg-gray-100">{['#', 'AWB', 'Receiver', 'Address', 'Phone', 'COD', 'Signature'].map((h) => <th key={h} className="border border-gray-200 p-1.5 text-start">{h}</th>)}</tr></thead>
        <tbody>
          {shipments.map((s, i) => (
            <tr key={s.id}>
              <td className="border border-gray-200 p-1.5">{i + 1}</td>
              <td className="border border-gray-200 p-1.5 font-semibold">{s.awb}</td>
              <td className="border border-gray-200 p-1.5">{s.receiver.name}</td>
              <td className="border border-gray-200 p-1.5">{s.receiver.address}, {s.receiver.city}</td>
              <td className="border border-gray-200 p-1.5">{s.receiver.phone}</td>
              <td className="border border-gray-200 p-1.5 font-semibold text-[#DC2626]">{s.cod > 0 ? fmtCurrency(s.cod, s.currency) : '-'}</td>
              <td className="w-24 border border-gray-200 p-1.5" />
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-sm font-semibold">COD to collect: {fmtCurrency(codTotal, rider.currency)}</p>
      <div className="flex justify-between"><Signature label="Rider signature" /><Signature label="Branch supervisor" /></div>
    </Sheet>
  );
}
