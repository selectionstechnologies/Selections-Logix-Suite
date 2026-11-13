// Document preparation in the browser, before upload:
//  - a PDF larger than COMPRESS_ABOVE is rebuilt with each page as a JPEG, stepping quality down
//    until it fits TARGET_BYTES (the original is kept if that does not make it smaller);
//  - several files picked together for "Company Docs" are combined into one PDF;
//  - large photos are scaled down.
// Libraries are loaded only when a document needs them, so normal pages stay light.

export const COMPRESS_ABOVE = 3 * 1024 * 1024; // PDFs above 3 MB are compressed
export const TARGET_BYTES = 3 * 1024 * 1024; // aim for 3 MB or less
export const MAX_INPUT_BYTES = 25 * 1024 * 1024; // bigger files are refused before processing
const IMAGE_MAX_SIDE = 2000; // px; plenty to read a CNIC or a stamp
const IMAGE_SHRINK_ABOVE = 1024 * 1024;

// Quality steps: render scale (1 = 72 dpi) and JPEG quality. ~150 dpi first, then lower.
const STEPS = [
  { scale: 2.0, quality: 0.72 },
  { scale: 1.6, quality: 0.62 },
  { scale: 1.3, quality: 0.55 },
  { scale: 1.1, quality: 0.45 },
];

const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
const isImage = (f) => /^image\/(jpeg|png|webp)$/.test(f.type);

let pdfjsPromise;
async function pdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    });
  }
  return pdfjsPromise;
}

const canvasToBytes = (canvas, quality) => new Promise((resolve) => {
  canvas.toBlob((b) => b.arrayBuffer().then((ab) => resolve(new Uint8Array(ab))), 'image/jpeg', quality);
});

async function loadImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Draws an image onto a white canvas no larger than maxSide (transparent PNGs get a white page). */
function imageCanvas(img, maxSide) {
  const ratio = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Builds one PDF from the given files (PDF pages and images, in order) at one quality step.
 * onProgress(done, total) reports pages.
 */
async function buildPdf(files, { scale, quality }, onProgress) {
  const { jsPDF } = await import('jspdf');
  let doc = null;
  const addPage = (canvas, wPt, hPt, bytes) => {
    const orientation = wPt > hPt ? 'l' : 'p';
    if (!doc) doc = new jsPDF({ orientation, unit: 'pt', format: [wPt, hPt], compress: true });
    else doc.addPage([wPt, hPt], orientation);
    doc.addImage(bytes, 'JPEG', 0, 0, wPt, hPt, undefined, 'FAST');
  };

  // Count pages first so progress is meaningful.
  const lib = files.some(isPdf) ? await pdfjs() : null;
  const opened = [];
  for (const f of files) {
    if (isPdf(f)) opened.push({ f, pdf: await lib.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise });
    else opened.push({ f });
  }
  const total = opened.reduce((n, o) => n + (o.pdf ? o.pdf.numPages : 1), 0);
  let done = 0;

  for (const o of opened) {
    if (o.pdf) {
      for (let i = 1; i <= o.pdf.numPages; i += 1) {
        const page = await o.pdf.getPage(i);
        const base = page.getViewport({ scale: 1 }); // PDF points
        const vp = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        addPage(canvas, base.width, base.height, await canvasToBytes(canvas, quality));
        page.cleanup();
        canvas.width = 0; // free memory early on long documents
        onProgress?.(++done, total);
      }
      await o.pdf.destroy();
    } else {
      const img = await loadImage(o.f);
      const canvas = imageCanvas(img, Math.round(IMAGE_MAX_SIDE * (scale / 2)));
      // Fit the picture on an A4-width page, keeping its shape.
      const wPt = 595;
      const hPt = Math.round((canvas.height / canvas.width) * wPt);
      addPage(canvas, wPt, hPt, await canvasToBytes(canvas, quality));
      onProgress?.(++done, total);
    }
  }
  return doc.output('blob');
}

const pdfName = (name) => `${name.replace(/\.[^.]+$/, '')}.pdf`;

async function shrinkImage(file) {
  if (file.size <= IMAGE_SHRINK_ABOVE) return file;
  const img = await loadImage(file);
  const canvas = imageCanvas(img, IMAGE_MAX_SIDE);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.75));
  return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }) : file;
}

/** Steps quality down until the PDF fits TARGET_BYTES; returns the smallest result. */
async function compressToTarget(files, name, onProgress) {
  let best = null;
  for (let s = 0; s < STEPS.length; s += 1) {
    const blob = await buildPdf(files, STEPS[s], (d, t) => onProgress?.(`Compressing page ${d} of ${t}${s ? ` (pass ${s + 1})` : ''}`));
    if (!best || blob.size < best.size) best = blob;
    if (blob.size <= TARGET_BYTES) break;
  }
  return new File([best], name, { type: 'application/pdf' });
}

/**
 * Prepares the picked files for one document type.
 * Returns [{ file, note }] ready to upload; note explains what was done (or '').
 * onProgress(text) reports what is happening.
 */
export async function prepareDocuments(files, docType, onProgress) {
  const tooBig = files.find((f) => f.size > MAX_INPUT_BYTES);
  if (tooBig) throw new Error(`${tooBig.name} is larger than 25 MB. Split it into smaller files.`);
  const bad = files.find((f) => !isPdf(f) && !isImage(f));
  if (bad) throw new Error(`${bad.name}: only PDF, JPG, PNG or WEBP files are allowed`);
  const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

  // Company Docs: everything picked together becomes one PDF.
  if (docType === 'Company Docs' && (files.length > 1 || isImage(files[0]))) {
    const name = files.length > 1 ? 'Company-Docs.pdf' : pdfName(files[0].name);
    const before = files.reduce((n, f) => n + f.size, 0);
    const out = await compressToTarget(files, name, onProgress);
    const what = files.length > 1 ? `${files.length} files combined into one PDF` : 'Picture converted to PDF';
    return [{ file: out, note: `${what} (${mb(before)} → ${mb(out.size)})` }];
  }

  const result = [];
  for (const f of files) {
    if (isPdf(f) && f.size > COMPRESS_ABOVE) {
      const out = await compressToTarget([f], f.name, onProgress);
      // Text-only PDFs can grow when rebuilt; keep whichever is smaller.
      result.push(out.size < f.size
        ? { file: out, note: `Compressed ${mb(f.size)} → ${mb(out.size)}` }
        : { file: f, note: '' });
    } else if (isImage(f)) {
      const out = await shrinkImage(f);
      result.push({ file: out, note: out !== f ? `Resized ${mb(f.size)} → ${mb(out.size)}` : '' });
    } else {
      result.push({ file: f, note: '' });
    }
  }
  return result;
}
