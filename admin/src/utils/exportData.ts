/**
 * Record exports used by every "Export data" sheet: Excel workbook (.xlsx), CSV, or a printable page
 * (browser Print / Save as PDF). The .xlsx is written directly (an uncompressed zip of the minimal
 * SpreadsheetML parts) so no spreadsheet library is shipped.
 */
export type ExportFormat = "xlsx" | "csv" | "print";
export type Cell = string | number | null | undefined;

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csv(headers: string[], rows: Cell[][]): string {
  return [headers, ...rows].map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
}

// ── Minimal zip (store method) ────────────────────────────────────────────
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zip(files: { name: string; data: string }[]): Blob {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = enc.encode(f.data);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, data.length, true);
    cen.setUint32(24, data.length, true);
    cen.setUint16(28, name.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function xlsx(sheet: string, headers: string[], rows: Cell[][]): Blob {
  const row = (cells: Cell[], r: number) =>
    `<row r="${r}">${cells.map((v, c) => {
      const ref = `${colName(c)}${r}`;
      return typeof v === "number" && Number.isFinite(v) ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v ?? ""))}</t></is></c>`;
    }).join("")}</row>`;
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${[headers, ...rows].map((r, i) => row(r, i + 1)).join("")}</sheetData></worksheet>`;
  const safe = esc(sheet.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet1");
  return zip([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${safe}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>` },
    { name: "xl/worksheets/sheet1.xml", data: sheetXml },
  ]);
}

function printTable(title: string, headers: string[], rows: Cell[][]) {
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font:12px Inter,Arial,sans-serif;color:#202a39;margin:24px}h1{font-size:18px;margin:0 0 4px}p{color:#5b687a;margin:0 0 14px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #e0e6ed;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f8fafc;font-size:10px;text-transform:uppercase;letter-spacing:.5px}</style></head><body><h1>${esc(title)}</h1><p>NESAM CABS · exported ${esc(new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }))} · ${rows.length} records</p><table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${esc(String(v ?? ""))}</td>`).join("")}</tr>`).join("")}</tbody></table><script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}

/** Exports `rows` in the chosen format. `name` becomes the file / sheet name. */
/**
 * Set by the app shell for the page that is open: null when the signed-in admin may export from
 * it, otherwise the reason. Exports are built in the browser from data the admin can already read,
 * so this is a usability control on top of the read rules, not a security boundary.
 */
let exportGuard: () => string | null = () => null;
export function setExportGuard(fn: () => string | null): void {
  exportGuard = fn;
}

export function exportRows(name: string, headers: string[], rows: Cell[][], format: ExportFormat): void {
  const denied = exportGuard();
  if (denied) {
    window.alert(denied);
    return;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const file = `${name.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_${stamp}`;
  if (format === "csv") download(`${file}.csv`, new Blob(["﻿" + csv(headers, rows)], { type: "text/csv;charset=utf-8" }));
  else if (format === "xlsx") download(`${file}.xlsx`, xlsx(name, headers, rows));
  else printTable(name, headers, rows);
}
