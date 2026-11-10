import { useEffect, useMemo, useRef, useState } from "react";
import type { VehicleCategory } from "../types";
import { compressCategoryImage, formatBytes, uploadCategoryMedia, categoryMediaProblem } from "../services/categoryMedia";
import { BRAND_IMAGE_BRANDS, setCategoryImage, type BrandImageKey } from "../services/categoryService";
import { Modal } from "./Feedback";
import { Button } from "./ui";

type RowState = "ready" | "working" | "done" | "error";

interface Row {
  key: string;
  file: File;
  preview: string;
  categoryId: string;
  state: RowState;
  message: string;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Best category for a file name: "innova-crysta.png" picks "Innova Crysta" over "Innova". */
export function matchCategory(fileName: string, categories: VehicleCategory[]): string {
  const base = squash(fileName.replace(/\.[^.]+$/, ""));
  if (base.length < 3) return "";
  let best = "";
  let bestScore = 0;
  for (const c of categories) {
    for (const key of [c.name, c.code, c.description ?? ""].map(squash)) {
      if (key.length < 3) continue;
      if (base.includes(key) || (base.length >= 4 && key.includes(base))) {
        const score = Math.min(key.length, base.length);
        if (score > bestScore) {
          best = c.id;
          bestScore = score;
        }
      }
    }
  }
  return best;
}

/**
 * Upload many car pictures at once. Each is matched to a vehicle category by its file name (changeable), then
 * written with the category name on the yellow number plate, compressed, stored, and linked to the category.
 */
export default function BulkCarImages({ categories, onClose, onDone }: {
  categories: VehicleCategory[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [writePlate, setWritePlate] = useState(true);
  const [brand, setBrand] = useState<BrandImageKey | "">("");
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [problem, setProblem] = useState("");
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const rowsRef = useRef<Row[]>([]);
  rowsRef.current = rows;
  const sorted = useMemo(
    () => [...categories].sort((a, b) => (a.displayOrder ?? 99) - (b.displayOrder ?? 99) || a.name.localeCompare(b.name)),
    [categories],
  );
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  // Free the preview pictures when the dialog closes.
  useEffect(() => () => rowsRef.current.forEach((r) => URL.revokeObjectURL(r.preview)), []);

  const addFiles = (list: FileList | File[]) => {
    const issues: string[] = [];
    const taken = new Set(rows.map((r) => r.categoryId).filter(Boolean));
    const fresh: Row[] = [];
    for (const file of Array.from(list)) {
      const bad = categoryMediaProblem(file);
      if (bad) { issues.push(`${file.name}: ${bad}`); continue; }
      let categoryId = matchCategory(file.name, categories);
      if (categoryId && taken.has(categoryId)) categoryId = ""; // one picture per category: the second one is chosen by hand
      if (categoryId) taken.add(categoryId);
      fresh.push({ key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`, file, preview: URL.createObjectURL(file), categoryId, state: "ready", message: "" });
    }
    setProblem(issues.join(" "));
    setFinished(false);
    setRows((cur) => [...cur, ...fresh]);
  };

  const setRow = (key: string, patch: Partial<Row>) => setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeRow = (key: string) => setRows((cur) => {
    const gone = cur.find((r) => r.key === key);
    if (gone) URL.revokeObjectURL(gone.preview);
    return cur.filter((r) => r.key !== key);
  });

  const usedTwice = useMemo(() => {
    const seen = new Map<string, number>();
    rows.forEach((r) => r.categoryId && seen.set(r.categoryId, (seen.get(r.categoryId) ?? 0) + 1));
    return new Set([...seen].filter(([, n]) => n > 1).map(([id]) => id));
  }, [rows]);
  const todo = rows.filter((r) => r.state !== "done");
  const blocked = todo.some((r) => !r.categoryId || usedTwice.has(r.categoryId));

  const run = async () => {
    setRunning(true);
    setProblem("");
    let ok = 0;
    for (const row of rowsRef.current) {
      if (row.state === "done") continue;
      const cat = byId.get(row.categoryId);
      if (!cat) continue;
      setRow(row.key, { state: "working", message: "Preparing…" });
      try {
        const result = await compressCategoryImage(row.file, "car", writePlate ? cat.name : undefined);
        setRow(row.key, { message: "Uploading…" });
        const url = await uploadCategoryMedia(result.file, "car", cat.id);
        await setCategoryImage(cat, url, brand || undefined);
        const plate = result.plate === "stamped" ? ` · “${cat.name.toUpperCase()}” written on the plate`
          : result.plate === "not-found" ? " · no yellow number plate found, name not added" : "";
        setRow(row.key, { state: "done", message: `${formatBytes(result.originalBytes)} → ${formatBytes(result.bytes)}${plate}` });
        ok += 1;
      } catch (err) {
        setRow(row.key, { state: "error", message: err instanceof Error ? err.message : "This image could not be saved." });
      }
    }
    setRunning(false);
    setFinished(true);
    if (ok) onDone(`${ok} car image${ok === 1 ? "" : "s"} uploaded.`);
  };

  const failed = rows.filter((r) => r.state === "error").length;
  const footer = finished && !failed ? (
    <Button variant="primary" onClick={onClose}>Close</Button>
  ) : (
    <>
      <Button onClick={onClose} disabled={running}>{finished ? "Close" : "Cancel"}</Button>
      <Button variant="primary" onClick={run} loading={running} disabled={!todo.length || blocked}>
        {failed ? `Retry ${todo.length} image${todo.length === 1 ? "" : "s"}` : `Upload ${todo.length || ""} image${todo.length === 1 ? "" : "s"}`.replace("  ", " ")}
      </Button>
    </>
  );

  return (
    <Modal title="Upload car images" subtitle="One picture per vehicle category. Each is compressed and saved, and the category name can be written on its number plate." onClose={onClose} busy={running} size="lg" footer={footer}
      footNote={blocked && todo.length ? <span className="text-[12px] font-semibold" style={{ color: "#a32831" }}>Choose a different category for every picture.</span> : undefined}>
      <div className="space-y-4">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); if (!running) addFiles(e.dataTransfer.files); }}
          className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${dragging ? "border-[#c1232c] bg-red-50" : "border-line bg-gray-50"}`}
        >
          <p className="text-[13px] font-semibold text-ink">Drop car pictures here</p>
          <p className="text-[11px] text-muted">PNG, JPG or WebP · up to 25 MB each · name a file like the category (for example “innova-crysta.png”) to match it automatically</p>
          <input ref={input} type="file" multiple accept="image/png,image/jpeg,image/webp" className="hidden" disabled={running}
            onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
          <Button onClick={() => input.current?.click()} disabled={running}>Choose pictures</Button>
        </div>

        <label className="flex flex-wrap items-center gap-2 text-[12px] font-semibold text-ink">
          Save these images for
          <select value={brand} disabled={running} onChange={(e) => setBrand(e.target.value as BrandImageKey | "")} className="rounded-lg border border-line bg-white px-2 py-1.5 text-[12px] font-semibold">
            <option value="">All brands (shared image)</option>
            {BRAND_IMAGE_BRANDS.map((b) => <option key={b.id} value={b.id}>{b.name} only</option>)}
          </select>
        </label>

        <label className="flex items-center gap-2 text-[12px] font-semibold text-ink">
          <input type="checkbox" checked={writePlate} disabled={running} onChange={(e) => setWritePlate(e.target.checked)} />
          Write the category name on the yellow number plate
        </label>
        {problem ? <p role="alert" className="text-[12px] text-red-600">{problem}</p> : null}

        {rows.length ? (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {rows.map((r) => {
              const dup = r.categoryId && usedTwice.has(r.categoryId);
              return (
                <li key={r.key} className="flex flex-wrap items-center gap-3 p-3">
                  <div className="flex h-14 w-20 shrink-0 items-center justify-center rounded-lg border border-line bg-gray-50">
                    <img src={r.preview} alt="" className="max-h-full max-w-full object-contain p-1" />
                  </div>
                  <div className="min-w-0 flex-1" style={{ minWidth: 180 }}>
                    <p className="truncate text-[12px] font-bold text-ink" title={r.file.name}>{r.file.name}</p>
                    <p className="text-[11px] text-muted">{formatBytes(r.file.size)}</p>
                    {r.message ? (
                      <p className={`text-[11px] ${r.state === "error" ? "text-red-600" : r.state === "done" ? "text-green-700" : "text-muted"}`} role={r.state === "error" ? "alert" : "status"}>{r.message}</p>
                    ) : null}
                  </div>
                  <select
                    aria-label={`Category for ${r.file.name}`}
                    value={r.categoryId}
                    disabled={running || r.state === "done"}
                    onChange={(e) => setRow(r.key, { categoryId: e.target.value })}
                    className={`rounded-lg border bg-white px-2 py-1.5 text-[12px] font-semibold ${!r.categoryId || dup ? "border-red-400" : "border-line"}`}
                  >
                    <option value="">Choose category…</option>
                    {sorted.map((c) => <option key={c.id} value={c.id}>{c.name}{c.description?.trim() && c.description.trim() !== c.name ? ` · ${c.description.trim()}` : ""}</option>)}
                  </select>
                  {r.state === "done" ? <span className="text-[12px] font-bold text-green-700">Done</span>
                    : <button type="button" disabled={running} onClick={() => removeRow(r.key)} className="text-[12px] font-semibold text-red-600 disabled:opacity-40" aria-label={`Remove ${r.file.name}`}>Remove</button>}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </Modal>
  );
}
