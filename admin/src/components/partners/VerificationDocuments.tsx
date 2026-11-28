import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { isUploaded, type VerifyDoc } from "../../domain/verificationDocs";
import { resolveStorageUrl } from "../../services/vendorReviewService";
import { Badge, Button, Icon } from "../ui";

const isPdf = (d: VerifyDoc, url: string) => d.contentType === "application/pdf" || /\.pdf($|\?)/i.test(url);
const expired = (date?: string) => !!date && Date.parse(date) < Date.now();

/** The viewable address of a document: its stored URL, or the Storage path resolved through Storage rules. */
function useDocUrl(d: VerifyDoc) {
  const [state, setState] = useState<{ url: string; failed: boolean }>({ url: d.url ?? "", failed: false });
  useEffect(() => {
    let alive = true;
    setState({ url: d.url ?? "", failed: false });
    if (!d.url && d.path) {
      resolveStorageUrl(d.path).then(
        (url) => alive && setState({ url, failed: false }),
        () => alive && setState({ url: "", failed: true }),
      );
    }
    return () => {
      alive = false;
    };
  }, [d.url, d.path]);
  return state;
}

function Tile({ d, seen, onOpen }: { d: VerifyDoc; seen: boolean; onOpen: () => void }) {
  const { url, failed } = useDocUrl(d);
  const [broken, setBroken] = useState(false);
  const on = isUploaded(d);
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!on}
      aria-label={on ? `Open ${d.label}` : `${d.label} not uploaded`}
      className={`flex flex-col text-left rounded-lg border overflow-hidden bg-white ${seen ? "border-green-300" : on ? "border-line hover:border-brand" : d.required ? "border-red-200 border-dashed" : "border-line border-dashed"}`}
    >
      <span className="flex h-24 w-full items-center justify-center overflow-hidden bg-surface-2 text-[11px] text-faint">
        {!on ? (
          <span className={d.required ? "text-brand font-semibold" : ""}>Not uploaded</span>
        ) : failed ? (
          <span className="text-brand">Could not load</span>
        ) : !url ? (
          "Loading…"
        ) : isPdf(d, url) || broken ? (
          <span className="flex flex-col items-center gap-1"><Icon name="file-text" size={22} />{isPdf(d, url) ? "PDF" : "File"}</span>
        ) : (
          <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" onError={() => setBroken(true)} />
        )}
      </span>
      <span className="block w-full px-2.5 py-2">
        <span className="block truncate text-[12px] font-semibold text-ink">{d.label}</span>
        <span className={`block text-[10.5px] font-medium ${seen ? "text-green-700" : "text-faint"}`}>{seen ? "✓ Checked" : on ? "Open to check" : d.required ? "Required" : "Optional"}</span>
        {d.expiry && <span className={`block text-[10.5px] ${expired(d.expiry) ? "font-bold text-brand" : "text-muted"}`}>{expired(d.expiry) ? "Expired" : "Valid till"} {d.expiry}</span>}
      </span>
    </button>
  );
}

/** Full-size view of one document. It counts as checked only once it has actually loaded here. */
function Viewer({ docs, index, onIndex, onSeen, onClose }: { docs: VerifyDoc[]; index: number; onIndex: (i: number) => void; onSeen: (key: string) => void; onClose: () => void }) {
  const d = docs[index];
  const { url, failed } = useDocUrl(d);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [d.key]);
  const step = useCallback((by: number) => onIndex((index + by + docs.length) % docs.length), [index, docs.length, onIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, step]);

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={d.label} className="fixed inset-0 flex flex-col bg-black/90 text-white" style={{ zIndex: 200 }}>
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <strong className="block truncate text-[14px]">{d.label}</strong>
          <span className="text-[11px] text-white/60">{d.group} · {index + 1} of {docs.length}{d.expiry ? ` · valid till ${d.expiry}` : ""}</span>
        </div>
        {url && <a href={url} target="_blank" rel="noopener noreferrer" className="text-[12px] font-semibold text-white underline">Open in new tab</a>}
        <Button iconOnly icon="x" aria-label="Close document" onClick={onClose} />
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-3">
        {failed || broken ? (
          <p className="text-[13px]">This file could not be shown here. {url ? "Use “Open in new tab”." : "Check your permissions and try again."}</p>
        ) : !url ? (
          <p className="text-[13px] text-white/70">Loading…</p>
        ) : isPdf(d, url) ? (
          <iframe key={d.key} title={d.label} src={url} onLoad={() => onSeen(d.key)} className="h-full w-full max-w-4xl rounded bg-white" />
        ) : (
          <img key={d.key} src={url} alt={d.label} onLoad={() => onSeen(d.key)} onError={() => setBroken(true)} className="max-h-full max-w-full object-contain" />
        )}
      </div>
      <div className="flex justify-center gap-2 px-4 pb-4">
        <Button icon="chevron-left" onClick={() => step(-1)} disabled={docs.length < 2}>Previous</Button>
        <Button variant="primary" onClick={() => (index === docs.length - 1 ? onClose() : step(1))}>{index === docs.length - 1 ? "Done" : "Next document"}</Button>
      </div>
    </div>,
    document.body,
  );
}

/** All of a partner's documents, grouped, with a full-screen viewer. */
export default function VerificationDocuments({ docs, seen, onSeen }: { docs: VerifyDoc[]; seen: ReadonlySet<string>; onSeen: (key: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const viewable = docs.filter(isUploaded);
  const index = viewable.findIndex((d) => d.key === open);
  const groups = Array.from(new Set(docs.map((d) => d.group)));
  const close = useCallback(() => setOpen(null), []);
  const move = useCallback((i: number) => setOpen(viewable[i]?.key ?? null), [viewable]);

  return (
    <>
      <div className="flex items-center justify-between gap-3 mt-5 mb-2">
        <h3 className="text-[14px] font-bold text-ink">Documents</h3>
        <div className="flex items-center gap-2">
          <Badge tone={viewable.length && viewable.every((d) => seen.has(d.key)) ? "green" : "amber"}>{viewable.filter((d) => seen.has(d.key)).length} / {viewable.length} checked</Badge>
          <Button size="sm" icon="eye" disabled={!viewable.length} onClick={() => setOpen((viewable.find((d) => !seen.has(d.key)) ?? viewable[0]).key)}>View documents</Button>
        </div>
      </div>
      {!docs.length && <p className="ds-note">No documents uploaded yet.</p>}
      {groups.map((g) => (
        <section key={g} className="mt-3">
          <h4 className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted">{g}</h4>
          <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
            {docs.filter((d) => d.group === g).map((d) => (
              <Tile key={d.key} d={d} seen={seen.has(d.key)} onOpen={() => setOpen(d.key)} />
            ))}
          </div>
        </section>
      ))}
      {index >= 0 && <Viewer docs={viewable} index={index} onIndex={move} onSeen={onSeen} onClose={close} />}
    </>
  );
}
