// CSV / Excel / PDF exporters. xlsx and jsPDF are heavy so they load on demand.
import Papa from 'papaparse';

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Neutralise spreadsheet formula injection: a cell starting with = + - @ runs as
 * a formula when opened in Excel. Real numbers are left alone.
 */
const safeCell = (v) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return v;
  const s = String(v);
  return /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
};

/** columns: [{ header, value(row) }] */
const toMatrix = (rows, columns) => rows.map((r) => columns.map((c) => safeCell(c.value(r))));

export function exportCSV(rows, columns, filename = 'export') {
  const csv = Papa.unparse({ fields: columns.map((c) => c.header), data: toMatrix(rows, columns) });
  // BOM so Excel opens Urdu and other non-ASCII text correctly.
  download(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }), `${filename}.csv`);
}

export async function exportXLSX(rows, columns, filename = 'export') {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet([columns.map((c) => c.header), ...toMatrix(rows, columns)]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data');
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

/** Plain paginated landscape table, drawn directly so no extra plugin is needed. */
export async function exportPDF(rows, columns, filename = 'export', title = filename) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 32;
  const shown = columns.slice(0, 10);
  const colW = (pageW - margin * 2) / shown.length;
  let y = margin;

  const header = () => {
    doc.setFillColor(250, 204, 21);
    doc.rect(margin, y - 11, pageW - margin * 2, 18, 'F');
    doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(17, 24, 39);
    shown.forEach((c, i) => doc.text(String(c.header).slice(0, 22), margin + i * colW + 3, y + 1));
    y += 18;
    doc.setFont('helvetica', 'normal');
  };

  doc.setFont('helvetica', 'bold').setFontSize(13).text(`Selections Logix Suite - ${title}`, margin, y);
  y += 12;
  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(107, 114, 128);
  doc.text(`${rows.length} records - generated ${new Date().toLocaleString()}`, margin, y);
  y += 20;
  header();

  rows.forEach((r) => {
    if (y > pageH - margin) {
      doc.addPage();
      y = margin + 8;
      header();
    }
    doc.setTextColor(17, 24, 39).setFontSize(7.5);
    shown.forEach((c, i) => {
      const maxChars = Math.floor(colW / 4);
      // Core PDF fonts only cover Latin-1, so strip anything else rather than print garbage.
      const text = String(c.value(r) ?? '').replace(/[^\x20-\x7E]/g, '').slice(0, maxChars);
      doc.text(text, margin + i * colW + 3, y);
    });
    doc.setDrawColor(229, 231, 235).line(margin, y + 4, pageW - margin, y + 4);
    y += 14;
  });
  doc.save(`${filename}.pdf`);
}

export function downloadText(text, filename, type = 'text/plain') {
  download(new Blob([text], { type }), filename);
}

/** Parse an uploaded CSV/XLS(X) file to an array of plain row objects. */
export async function parseSpreadsheet(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim(),
        complete: (res) => resolve(res.data),
        error: reject,
      });
    });
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(await file.arrayBuffer());
    return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
  }
  throw new Error('Please upload a .csv, .xlsx or .xls file');
}

/** Rasterise a DOM node to a PDF sized to the node's aspect ratio. */
export async function elementToPDF(node, filename = 'document') {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const canvas = await html2canvas(node, { scale: 2, backgroundColor: '#FFFFFF', useCORS: true });
  const pdf = new jsPDF({
    orientation: canvas.width > canvas.height ? 'landscape' : 'portrait',
    unit: 'px',
    format: [canvas.width / 2, canvas.height / 2],
    hotfixes: ['px_scaling'],
  });
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width / 2, canvas.height / 2);
  pdf.save(`${filename}.pdf`);
}
