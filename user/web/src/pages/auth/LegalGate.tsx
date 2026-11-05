// Stops the app until the signed-in rider has accepted the current published terms,
// privacy policy and consents for customers (a new version asks again). If nothing is
// published, or the status can't be read, it lets them through (same as the app).
import { useEffect, useState, type ReactNode } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/platform/firebase';
import { ActionError, callFunction } from '@core/services/callables';
import { Button, Checkbox, Notice, PageHead, PageLoader } from '@/components/ui';
import { Icon } from '@/components/Icon';

interface RequiredDoc {
  key: string;
  title: string;
  version: number;
  type: string;
  checkboxText: string;
}

export function LegalGate({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const [state, setState] = useState<'loading' | 'ok' | 'needed'>(enabled ? 'loading' : 'ok');
  // Signing in on a page that is already showing keeps that page while the check runs.
  const [shownBefore] = useState(!enabled);
  const [missing, setMissing] = useState<RequiredDoc[]>([]);
  const [bodies, setBodies] = useState<Record<string, string>>({});
  const [open, setOpen] = useState('');
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled) {
      setState('ok');
      return undefined;
    }
    let alive = true;
    (async () => {
      try {
        const s = await callFunction<unknown, { missing: RequiredDoc[] }>('getLegalStatus', { role: 'customer' });
        if (!alive) return;
        if (!s.missing.length) return setState('ok');
        const entries = await Promise.all(s.missing.map(async (m) => [m.key, String((await getDoc(doc(db, 'legal_documents', m.key))).data()?.body ?? '')] as const));
        if (!alive) return;
        setMissing(s.missing);
        setOpen(s.missing[0]!.key);
        setBodies(Object.fromEntries(entries));
        setState('needed');
      } catch {
        // Not being able to read the status must not lock the rider out.
        if (alive) setState('ok');
      }
    })();
    return () => {
      alive = false;
    };
  }, [enabled]);

  if (state === 'loading') return shownBefore ? <>{children}</> : <PageLoader label="Checking terms…" />;
  if (state === 'ok') return <>{children}</>;

  const text = missing.find((m) => m.checkboxText)?.checkboxText || 'I agree to the Terms & Conditions and Privacy Policy.';
  const accept = async () => {
    setBusy(true);
    setError('');
    try {
      await callFunction('acceptLegalDocuments', {
        role: 'customer',
        confirmed: true,
        accept: missing.map((m) => ({ key: m.key, version: m.version })),
        checkboxText: text,
        source: 'customer_web',
        device: { platform: 'web', appVersion: '' },
      });
      setState('ok');
    } catch (err) {
      setError(err instanceof ActionError ? err.message : 'Could not record your acceptance. Try again.');
      setBusy(false);
    }
  };

  return (
    <main id="main" tabIndex={-1} className="gate-page">
      <div className="wrap gate">
        <PageHead eyebrow="Before you continue" title="Review and accept to continue">
          These documents are new or have changed since you last accepted.
        </PageHead>
        <div className="stack">
          {missing.map((m) => (
            <section key={m.key} className="card legal-doc">
              <button type="button" className="legal-doc__head" aria-expanded={open === m.key} onClick={() => setOpen(open === m.key ? '' : m.key)}>
                <span>
                  <strong>{m.title}</strong>
                  <small className="muted"> · version {m.version}</small>
                </span>
                <Icon name={open === m.key ? 'chevron-up' : 'chevron-down'} />
              </button>
              {open === m.key ? <div className="legal-doc__body">{bodies[m.key] || 'This document has no text yet.'}</div> : null}
            </section>
          ))}
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Checkbox checked={checked} onChange={setChecked}>
            {text}
          </Checkbox>
          <div>
            <Button size="lg" loading={busy} disabled={!checked} onClick={() => void accept()}>
              Accept and continue
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
