// Downloadable GST bills: one A4 PDF per document, or a ZIP of many with a register (CSV).
// Drawn from the saved document only, so a download always matches what was issued.
import { jsPDF } from "jspdf";
import { strToU8, zipSync } from "fflate";
import { csv, type Cell } from "../utils/exportData";
import { GST_STATES } from "../domain/gstStates";
import { amountInWords } from "./invoiceService";
import type { Invoice } from "../types";

export interface Signature { name: string; image: string }

const W = 210, H = 297, M = 14, RIGHT = W - M;
const money = (n: number | undefined) => "Rs. " + (Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** The built-in PDF fonts cover Latin-1 only; these common characters have a plain equivalent. */
const plain = (s: string) => s.replace(/₹\s?/g, "Rs. ").replace(/→/g, "->").replace(/[—–]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, "...").replace(/[•·]/g, "-");
const needsCanvas = (s: string) => /[^\x00-\xFF]/.test(s) && typeof document !== "undefined";
const stateCodeOf = (name: string) => GST_STATES.find(([, n]) => n.toLowerCase() === name.trim().toLowerCase())?.[0] ?? "";
const stateLabel = (code: string) => { const n = GST_STATES.find(([c]) => c === code)?.[1]; return n ? `${n} (${code})` : ""; };

export const documentTitle = (inv: Invoice) => (inv.documentType || "Tax invoice").toUpperCase();
export const pdfName = (inv: Invoice) => `${(inv.invoiceNumber || inv.id).replace(/[\\/:*?"<>|]+/g, "-")}.pdf`;

/** A small writer over jsPDF. Text in other scripts (for example Tamil names) is drawn by the browser as an image. */
function writer(doc: jsPDF) {
  const canvasFont = (size: number, bold: boolean) => `${bold ? "bold " : ""}${size * 4}px sans-serif`;
  const set = (size: number, bold: boolean) => { doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); };
  /** Points × 4 canvas pixels → millimetres. */
  const PX = 25.4 / 72 / 4;
  function wrap(text: string, width: number, size: number, bold = false): string[] {
    const t = plain(text);
    set(size, bold);
    if (!needsCanvas(t)) return doc.splitTextToSize(t, width) as string[];
    const g = document.createElement("canvas").getContext("2d")!;
    g.font = canvasFont(size, bold);
    const out: string[] = [];
    for (const para of t.split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (line && g.measureText(next).width * PX > width) { out.push(line); line = word; } else line = next;
      }
      out.push(line);
    }
    return out;
  }
  function put(text: string, x: number, y: number, o: { size?: number; bold?: boolean; align?: "left" | "right" | "center" } = {}) {
    const { size = 9, bold = false, align = "left" } = o;
    const t = plain(text);
    set(size, bold);
    if (!needsCanvas(t)) { doc.text(t, x, y, { align }); return; }
    const canvas = document.createElement("canvas");
    const g = canvas.getContext("2d")!;
    g.font = canvasFont(size, bold);
    canvas.width = Math.ceil(g.measureText(t).width) + 4;
    canvas.height = Math.ceil(size * 4 * 1.5);
    g.font = canvasFont(size, bold);
    g.fillStyle = "#111111";
    g.fillText(t, 0, size * 4 * 1.1);
    const w = canvas.width * PX, h = canvas.height * PX;
    doc.addImage(canvas.toDataURL("image/png"), "PNG", align === "right" ? x - w : align === "center" ? x - w / 2 : x, y - size * 4 * 1.1 * PX, w, h);
  }
  /** Writes wrapped lines and returns the next free y. */
  function block(text: string, x: number, y: number, width: number, o: { size?: number; bold?: boolean } = {}) {
    const size = o.size ?? 9;
    for (const line of wrap(text, width, size, o.bold)) { put(line, x, y, o); y += size * 0.45; }
    return y;
  }
  return { wrap, put, block };
}

export function buildGstPdf(inv: Invoice, signature?: Signature | null): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const { wrap, put, block } = writer(doc);
  const c = inv.companySnapshot ?? { name: "", gstin: "", address: "", phone: "", email: "" };
  const r = inv.customerSnapshot ?? { name: "" };
  const t = inv.tripSnapshot ?? {};
  const isPaymentReceipt = inv.documentType === "Payment receipt";
  const isVoucher = inv.documentType === "Receipt voucher" || inv.documentType === "Refund voucher";

  // ── Supplier and document ──
  let left = block(c.name || "", M, 18, 112, { size: 15, bold: true }) + 1;
  left = block(c.address || "", M, left, 112);
  left = block([c.phone && `Phone: ${c.phone}`, c.email && `Email: ${c.email}`].filter(Boolean).join("   "), M, left, 112);
  left = block(`GSTIN: ${c.gstin}`, M, left + 0.5, 112, { bold: true });
  left = block(stateLabel((c.gstin || "").slice(0, 2)) && `State: ${stateLabel((c.gstin || "").slice(0, 2))}`, M, left, 112);
  put(documentTitle(inv), RIGHT, 18, { size: 14, bold: true, align: "right" });
  put("Original for recipient", RIGHT, 23, { size: 8, align: "right" });
  put(`No: ${inv.invoiceNumber}`, RIGHT, 29, { size: 10, bold: true, align: "right" });
  put(`Date: ${inv.invoiceDate}`, RIGHT, 34, { align: "right" });
  put(`Booking: ${inv.bookingId}`, RIGHT, 38.5, { align: "right" });
  let y = Math.max(left, 41) + 2;
  if (inv.invoiceStatus === "Cancelled") {
    doc.setTextColor(200, 30, 30);
    y = block(`CANCELLED / VOID${inv.voidReason ? ` - ${inv.voidReason}` : ""}`, M, y + 3, RIGHT - M, { size: 12, bold: true }) + 1;
    doc.setTextColor(0, 0, 0);
  }
  doc.setDrawColor(170);
  doc.line(M, y, RIGHT, y);

  // ── Recipient and supply ──
  y += 5.5;
  const place = inv.placeOfSupply ? `${inv.placeOfSupply}${stateCodeOf(inv.placeOfSupply) ? ` (${stateCodeOf(inv.placeOfSupply)})` : ""}` : "";
  const column = (x: number, title: string, rows: (string | false | undefined)[]) => {
    put(title, x, y, { size: 8, bold: true });
    let at = y + 4.5;
    for (const row of rows) if (row) at = block(row, x, at, 86) + 0.3;
    return at;
  };
  const a = column(M, isPaymentReceipt ? "RECEIVED FROM" : "BILLED TO", [
    r.name, r.address && `Address: ${r.address}`, r.phone && `Phone: ${r.phone}`, r.email && `Email: ${r.email}`,
    r.gstin ? `GSTIN: ${r.gstin}` : "GSTIN: Unregistered", r.gstin && stateLabel(r.gstin.slice(0, 2)) && `State: ${stateLabel(r.gstin.slice(0, 2))}`,
  ]);
  const b = column(M + 94, "SUPPLY DETAILS", [
    place && `Place of supply: ${place}`, !isPaymentReceipt && "Tax payable on reverse charge: No",
    inv.originalInvoiceNumber && `Against: ${inv.originalInvoiceNumber}${inv.originalInvoiceDate ? ` dated ${inv.originalInvoiceDate}` : ""}`,
    t.service && `Service: ${t.service}${t.vehicle ? ` (${t.vehicle})` : ""}`, (t.pickup || t.drop) && `Route: ${t.pickup || "-"} -> ${t.drop || "-"}`,
    t.travelDate && `Travel: ${t.travelDate} ${t.travelTime || ""}`, t.vehicleNumber && `Vehicle no: ${t.vehicleNumber}`,
    t.driverName && `Driver: ${t.driverName}`, Number(t.distanceKm) > 0 && `Distance: ${t.distanceKm} km`,
    inv.payment?.method && `Payment: ${[inv.payment.method, inv.payment.reference, inv.payment.date].filter(Boolean).join(" / ")}`,
    inv.payment?.collectedBy && `Collected by: ${inv.payment.collectedBy}`,
  ]);
  y = Math.max(a, b) + 2;

  // ── Lines ──
  const head = () => {
    doc.setFillColor(238, 240, 243);
    doc.rect(M, y, RIGHT - M, 7, "F");
    put("#", M + 2, y + 4.8, { size: 8, bold: true });
    put("DESCRIPTION", M + 10, y + 4.8, { size: 8, bold: true });
    put("SAC", 150, y + 4.8, { size: 8, bold: true, align: "center" });
    put("AMOUNT", RIGHT - 2, y + 4.8, { size: 8, bold: true, align: "right" });
    y += 11.5;
  };
  const room = (needed: number, table = false) => { if (y + needed > H - 16) { doc.addPage(); y = 18; if (table) head(); } };
  room(24);
  head();
  (inv.items || []).forEach((item, i) => {
    const lines = wrap(item.description, 112, 9);
    room(lines.length * 4.1 + 3, true);
    put(String(i + 1), M + 2, y);
    lines.forEach((line, n) => put(line, M + 10, y + n * 4.1));
    put(item.sacCode || "-", 150, y, { align: "center" });
    put(money(item.amount), RIGHT - 2, y, { align: "right" });
    y += lines.length * 4.1 + 1.5;
    doc.setDrawColor(225);
    doc.line(M, y - 2.6, RIGHT, y - 2.6);
    y += 1.2;
  });

  // ── Totals ──
  const rate = inv.gstRate > 1 ? inv.gstRate : (Number(inv.gstRate) || 0) * 100;
  const pct = (n: number) => `${Math.round(n * 100) / 100}%`;
  const other = Math.round((inv.grandTotal - inv.taxableAmount - inv.totalTax) * 100) / 100;
  const rows: [string, string][] = [];
  if (!isPaymentReceipt) {
    if (inv.discount > 0) rows.push(["Subtotal", money(inv.subtotal)], ["Discount", "- " + money(inv.discount)]);
    rows.push(["Taxable value", money(inv.taxableAmount)]);
    if (inv.taxSplit === "IGST" || (inv.igst ?? 0) > 0) rows.push([`IGST @ ${pct(rate)}`, money(inv.igst)]);
    else {
      const ut = inv.taxSplit === "CGST + UTGST" || (inv.utgst ?? 0) > 0;
      rows.push([`CGST @ ${pct(rate / 2)}`, money(inv.cgst)], [`${ut ? "UTGST" : "SGST"} @ ${pct(rate / 2)}`, money(ut ? inv.utgst : inv.sgst)]);
    }
    rows.push(["Total tax", money(inv.totalTax)]);
    if (Math.abs(other) >= 0.01) rows.push(["Non-taxable charges", money(other)]);
  }
  room(rows.length * 5 + 30);
  y += 2;
  let right = y;
  for (const [label, value] of rows) { put(label, 130, right); put(value, RIGHT - 2, right, { align: "right" }); right += 5; }
  doc.setDrawColor(120);
  doc.line(128, right - 2.5, RIGHT, right - 2.5);
  right += 2.5;
  put(isPaymentReceipt || isVoucher ? "Amount" : "Grand total", 130, right, { size: 11, bold: true });
  put(money(inv.grandTotal), RIGHT - 2, right, { size: 11, bold: true, align: "right" });
  if (!isPaymentReceipt && !isVoucher) {
    right += 5.5;
    put("Paid", 130, right); put(money(inv.paidAmount), RIGHT - 2, right, { align: "right" });
    right += 5;
    put("Balance due", 130, right); put(money(inv.balanceAmount), RIGHT - 2, right, { align: "right" });
  }
  put("Amount in words", M, y, { size: 8, bold: true });
  let words = block(amountInWords(inv.grandTotal), M, y + 4.5, 105);
  const note = isPaymentReceipt ? `This receipt is not a tax invoice.${inv.originalInvoiceNumber ? ` Tax is shown on invoice ${inv.originalInvoiceNumber}.` : ""}`
    : isVoucher ? "The amount shown includes GST." : inv.terms || "";
  words = block(note, M, words + 3, 105, { size: 8 });
  y = Math.max(right, words) + 8;

  // ── Signature (Rule 46(q) / 50(h) / 51) ──
  room(34);
  put(`For ${c.name}`, RIGHT, y, { bold: true, align: "right" });
  if (signature?.image) {
    try {
      const p = doc.getImageProperties(signature.image);
      const scale = Math.min(45 / p.width, 17 / p.height);
      doc.addImage(signature.image, p.fileType, RIGHT - p.width * scale, y + 2, p.width * scale, p.height * scale);
    } catch { /* an unreadable image leaves the space for a hand signature */ }
  }
  if (signature?.name) put(signature.name, RIGHT, y + 24, { align: "right" });
  put("Authorised Signatory", RIGHT, y + 28.5, { size: 8, align: "right" });
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) { doc.setPage(i); put(`${inv.invoiceNumber}  -  Page ${i} of ${pages}`, W / 2, H - 8, { size: 7, align: "center" }); }
  return doc;
}

function saveBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadGstPdf(inv: Invoice, signature?: Signature | null) {
  saveBlob(pdfName(inv), buildGstPdf(inv, signature).output("blob"));
}

const REGISTER = ["Document type", "Number", "Date", "Status", "Booking", "Customer", "Customer GSTIN", "Place of supply", "Taxable", "CGST", "SGST", "UTGST", "IGST", "Total tax", "Total", "Against"];
export const registerRows = (docs: Invoice[]): Cell[][] => docs.map((i) => [
  i.documentType || "Tax invoice", i.invoiceNumber, i.invoiceDate, i.invoiceStatus, i.bookingId, i.customerSnapshot?.name ?? "", i.customerSnapshot?.gstin ?? "", i.placeOfSupply ?? "",
  i.taxableAmount, i.cgst, i.sgst, i.utgst ?? 0, i.igst ?? 0, i.totalTax, i.grandTotal, i.originalInvoiceNumber ?? "",
]);

/** The files of a bulk download: every document as a PDF plus register.csv. */
export async function gstZipFiles(docs: Invoice[], signature?: Signature | null, onProgress?: (done: number) => void): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {};
  for (let i = 0; i < docs.length; i++) {
    const inv = docs[i];
    const folder = (inv.documentType || "Tax invoice").replace(/\s+/g, "-");
    let name = `${folder}/${pdfName(inv)}`;
    if (files[name]) name = name.replace(/\.pdf$/, `-${inv.id}.pdf`);
    files[name] = new Uint8Array(buildGstPdf(inv, signature).output("arraybuffer"));
    if (i % 10 === 9) { onProgress?.(i + 1); await new Promise((done) => setTimeout(done)); } // keep the page responsive
  }
  files["register.csv"] = strToU8("﻿" + csv(REGISTER, registerRows(docs)));
  return files;
}

export async function downloadGstZip(name: string, docs: Invoice[], signature?: Signature | null, onProgress?: (done: number) => void) {
  const files = await gstZipFiles(docs, signature, onProgress);
  saveBlob(`${name}.zip`, new Blob([zipSync(files, { level: 0 }) as Uint8Array<ArrayBuffer>], { type: "application/zip" }));
}
