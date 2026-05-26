#!/usr/bin/env node
import fs from 'fs/promises';
import { pathToFileURL } from 'url';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const pdfPath = arg('--pdf');
const pdfjsModule = arg('--pdfjs-module', process.env.PDFJS_DIST_MODULE || 'C:/Users/dep/Projekter/DEMO_FD_Restarbejde/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
if (!pdfPath) {
  console.error('ERROR: --pdf is required');
  process.exit(1);
}

try {
  const pdfjs = await import(pathToFileURL(pdfjsModule).href);
  const data = new Uint8Array(await fs.readFile(pdfPath));
  const loadingTask = pdfjs.getDocument({ data, useWorkerFetch: false, isEvalSupported: false, disableFontFace: true });
  const doc = await loadingTask.promise;
  const metadata = await doc.getMetadata().catch(() => null);
  const pages = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent({ includeMarkedContent: false, disableNormalization: false });
    const text = content.items.map((item) => item.str || '').join(' ').replace(/\s+/g, ' ').trim();
    pages.push({ pageNumber, text });
  }
  console.log(JSON.stringify({
    ok: true,
    pageCount: doc.numPages,
    title: metadata?.info?.Title || null,
    author: metadata?.info?.Author || null,
    subject: metadata?.info?.Subject || null,
    creator: metadata?.info?.Creator || null,
    producer: metadata?.info?.Producer || null,
    pages,
  }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: `${error?.name || 'Error'}: ${error?.message || error}` }));
  process.exit(0);
}
