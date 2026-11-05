import { useEffect, useMemo, useRef, useState } from "react";
import { subscribeToCollection } from "../services/adminFirestoreService";
import { publishLegalDocument, saveLegalDraft, seedLegalDocuments } from "../services/bookingOpsService";
import { ActionError } from "../services/callables";
import { ErrorBanner, Modal, Toast, useToast } from "../components/Feedback";
import { Field, Notice, inputCls, primaryBtn, secondaryBtn } from "../components/FormKit";
import { useAccess, useCan, useCanDo } from "../components/AccessContext";
import { formatDateTime12, toDate } from "../utils/time";
import { LEGAL_DEFAULTS } from "../../../functions/src/domain/legalDefaults";

interface LegalDoc {
  id: string; key: string; type: string; role: string; title: string; body: string; checkboxText: string; requiresAcceptance: boolean;
  version: number; status: "Template" | "Draft" | "Published"; draftRevision?: number; changeSummary?: string; publishedAt?: unknown; publishedByName?: string;
}

const ROLE_LABEL: Record<string, string> = { customer: "Customers", driver: "Drivers", vendor: "Vendors", admin: "Staff" };
const TYPE_LABEL: Record<string, string> = {
  terms: "Terms & Conditions", privacy: "Privacy Policy", driver_terms: "Driver Terms", vendor_terms: "Vendor Terms", cancellation: "Cancellation Policy",
  refund: "Refund Policy", payment: "Payment Terms", vehicle_verification_consent: "Vehicle photo consent", location_consent: "Location permission",
};

/** Terms, privacy and consent documents per role. Publishing a new version asks everyone to accept again. */
export default function LegalDocuments() {
  const canSystem = useCan("system");
  const canEditSettings = useCanDo('Settings', 'edit');
  const canEdit = canSystem && canEditSettings;
  const access = useAccess();
  const [docs, setDocs] = useState<LegalDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState<LegalDoc | null>(null);
  const [seeding, setSeeding] = useState(false);
  const seedInFlight = useRef(false);
  const { toast, show } = useToast(7000);

  useEffect(() => {
    setDocs(null);
    setError(null);
    return subscribeToCollection<LegalDoc>("legal_documents", (d) => { setDocs(d); setError(null); }, (m) => { setError(m); setDocs(null); });
  }, [retry]);

  const seed = async () => {
    if (seedInFlight.current || !access.isSuper || docs === null || error) return;
    seedInFlight.current = true;
    setSeeding(true);
    try {
      const r = await seedLegalDocuments();
      show(r.created ? `${r.created} starter templates created as drafts. Review and edit them, then publish.` : "All starter templates already exist.");
      setRetry(current => current + 1);
    } catch (e) {
      show(e instanceof ActionError ? e.message : "Could not create the templates.", "error");
    } finally {
      seedInFlight.current = false;
      setSeeding(false);
    }
  };

  const missingTemplates = useMemo<LegalDoc[]>(() => docs === null || error ? [] : LEGAL_DEFAULTS
    .filter(template => !docs.some(document => document.id === template.key))
    .map(template => ({ ...template, id: template.key, status: 'Template', version: 0, draftRevision: 0 })), [docs, error]);
  const displayed = error ? [] : [...(docs ?? []), ...missingTemplates];
  const roles = Array.from(new Set(['customer', 'driver', 'vendor', 'admin', ...displayed.map(document => document.role)]));
  const grouped = roles.map(role => ({ role, items: displayed.filter(document => document.role === role).sort((a, b) => a.title.localeCompare(b.title)) }));
  const publishedCount = (docs ?? []).filter(document => document.status === 'Published').length;

  return (
    <div className="p-4 md:p-6 space-y-5">
      <Toast toast={toast} />
      {error && <ErrorBanner message={error} onRetry={() => setRetry((n) => n + 1)} />}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">Terms, Privacy & Consent</h1>
          <p className="text-sm text-muted">Role-specific documents. Users must accept the published version before they continue; a new version asks them again. Each acceptance records the user, version, time and device.</p>
        </div>
        {access.isSuper && missingTemplates.length > 0 && <button onClick={seed} disabled={seeding || docs === null || !!error} className={secondaryBtn}>{seeding ? "Creating drafts…" : `Create ${missingTemplates.length} missing drafts`}</button>}
      </div>
      {!error && docs !== null && <Notice tone="info">{publishedCount} published · {(docs ?? []).filter(document => document.status === 'Draft').length} saved drafts · {missingTemplates.length} unsaved starter templates. Review a document below to save a draft or publish an approved version. Only published documents are available to users.</Notice>}
      {displayed.some(document => document.status !== 'Published') && <Notice tone="warn">Starter text must be reviewed and edited for how NESAM operates before publishing. Templates are previews, not saved policies; drafts are not shown to users or enforced.</Notice>}

      {docs === null && !error && <p className="text-sm text-muted" role="status">Loading documents…</p>}
      {docs !== null && docs.length === 0 && !error && <p className="text-sm text-muted">No policies have been saved yet. The role-specific templates below are ready to review.{!canEdit && ' A staff member with system and Settings edit access must save or publish them.'}</p>}

      {grouped.filter((g) => g.items.length).map((g) => (
        <section key={g.role} className="bg-white rounded-xl border border-line overflow-hidden">
          <h2 className="px-4 py-3 text-sm font-bold text-ink bg-surface-2 border-b border-line">{ROLE_LABEL[g.role] ?? g.role}</h2>
          <ul className="divide-y divide-line-soft">
            {g.items.map((d) => (
              <li key={d.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-ink">{d.title}</div>
                  <div className="text-xs text-muted">{TYPE_LABEL[d.type] ?? d.type}{d.requiresAcceptance ? " · acceptance required" : " · information only"}</div>
                  <div className="text-xs text-muted">{d.status === "Published" ? `Published v${d.version} · ${formatDateTime12(toDate(d.publishedAt as never))}${d.publishedByName ? ` · ${d.publishedByName}` : ""}` : d.status === 'Template' ? 'Starter preview — not saved or published' : "Saved draft — not yet published"}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${d.status === "Published" ? "bg-green-50 text-green-800 border-green-300" : "bg-amber-50 text-amber-900 border-amber-300"}`}>{d.status === 'Template' ? 'Not saved' : d.status}</span>
                  <button onClick={() => setEditing(d)} disabled={seeding} className={secondaryBtn}>{canEdit ? d.status === 'Template' ? 'Review template' : "Edit / publish" : "View"}</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {editing && <Editor key={editing.id} doc={editing} canEdit={canEdit} onClose={() => setEditing(null)} onDone={(t) => { setEditing(null); setRetry(current => current + 1); show(t); }} />}
    </div>
  );
}

function Editor({ doc, canEdit, onClose, onDone }: { doc: LegalDoc; canEdit: boolean; onClose: () => void; onDone: (t: string) => void }) {
  const [title, setTitle] = useState(doc.title);
  const [body, setBody] = useState(doc.body);
  const [checkbox, setCheckbox] = useState(doc.checkboxText);
  const [required, setRequired] = useState(doc.requiresAcceptance);
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState<'draft' | 'publish' | null>(null);
  const saving = useRef(false);
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = title !== doc.title || body !== doc.body || checkbox !== doc.checkboxText || required !== doc.requiresAcceptance;

  useEffect(() => { setReviewed(false); }, [title, body, checkbox, required]);
  const save = async (mode: 'draft' | 'publish') => {
    if (!canEdit || saving.current) return;
    if (title.trim().length < 3) return setError("Enter a title.");
    if (!body.trim() || body.trim().length > 60000) return setError('Enter draft text up to 60,000 characters.');
    if (mode === 'publish' && body.trim().length < 40) return setError("The text is too short to publish.");
    if (mode === 'publish' && required && checkbox.trim().length < 10) return setError("Enter the text shown next to the checkbox.");
    if (mode === 'publish' && !reviewed) return setError('Confirm that the document has been reviewed before publishing.');
    if (mode === 'publish' && doc.status === "Published" && summary.trim().length < 5) return setError("Say briefly what changed — users will see that they must accept a new version.");
    const expectedStatus: 'Missing' | 'Draft' | 'Published' = doc.status === 'Template' ? 'Missing' : doc.status;
    const input = { type: doc.type, role: doc.role, title: title.trim(), body, checkboxText: checkbox.trim(), requiresAcceptance: required,
      changeSummary: summary.trim(), expectedVersion: doc.version, expectedRevision: doc.draftRevision ?? 0, expectedStatus };
    saving.current = true;
    setBusy(mode);
    setError(null);
    try {
      if (mode === 'draft') {
        await saveLegalDraft(input);
        onDone('Draft saved. It is not published or enforced.');
      } else {
        const r = await publishLegalDocument({ ...input, reviewed });
        onDone(`Published version ${r.version}. ${required ? "Users are asked to accept it." : ""}`);
      }
    } catch (e) {
      setError(e instanceof ActionError ? e.message : "Could not save the document.");
    } finally {
      saving.current = false;
      setBusy(null);
    }
  };

  return (
    <Modal title={doc.title} subtitle={`${ROLE_LABEL[doc.role] ?? doc.role} · ${doc.status === "Published" ? `version ${doc.version}` : doc.status === 'Template' ? 'unsaved starter template' : "saved draft"}`} onClose={onClose} busy={!!busy} size="xl"
      footer={<><button onClick={onClose} disabled={!!busy} className={secondaryBtn}>Close</button>{canEdit && doc.status !== 'Published' && <button onClick={() => void save('draft')} disabled={!!busy || (doc.status === 'Draft' && !changed)} className={secondaryBtn}>{busy === 'draft' ? 'Saving draft…' : 'Save draft'}</button>}{canEdit && <button onClick={() => void save('publish')} disabled={!!busy || (doc.status === "Published" && !changed)} className={primaryBtn}>{busy === 'publish' ? "Publishing…" : doc.status === "Published" ? "Publish new version" : "Publish reviewed document"}</button>}</>}>
      <div className="space-y-3">
        {error && <Notice tone="error">{error}</Notice>}
        {doc.status === 'Template' && <Notice tone="info">This is an unsaved starter template. Saving a draft keeps it private to staff. Publishing makes this version available to users.</Notice>}
        <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!canEdit || !!busy} maxLength={140} className={inputCls} /></Field>
        <Field label="Text" hint="Plain text. Blank lines separate paragraphs."><textarea value={body} onChange={(e) => setBody(e.target.value)} disabled={!canEdit || !!busy} maxLength={60000} rows={16} className={`${inputCls} font-mono`} /></Field>
        <Field label="Checkbox text" hint="Exactly what the user ticks. Keep it honest: it should say only that they have read / agree to this document."><input value={checkbox} onChange={(e) => setCheckbox(e.target.value)} disabled={!canEdit || !!busy} maxLength={300} className={inputCls} /></Field>
        <label className="flex items-center gap-2 text-sm font-semibold text-body"><input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} disabled={!canEdit || !!busy} className="w-4 h-4 accent-brand" />Users must accept this before continuing</label>
        {canEdit && doc.status === "Published" && <Field label="What changed" required><input value={summary} onChange={(e) => setSummary(e.target.value)} disabled={!!busy} maxLength={300} className={inputCls} /></Field>}
        {canEdit && <label className="flex items-center gap-2 text-sm text-body"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} disabled={!!busy} />This document and its acceptance settings have been reviewed for our business and are ready to publish.</label>}
      </div>
    </Modal>
  );
}
