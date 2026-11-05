// Stops the app until the signed-in rider has accepted the current published terms,
// privacy policy and consents for customers (a new version asks again). If nothing is
// published, or the status can't be read, it lets them through (same as the app).
// The check runs in the background: the app shows meanwhile, so it never holds up the first screen.
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/platform/firebase';
import { ActionError, callFunction } from '@core/services/callables';
import { Button, Checkbox, Notice, PageHead } from '@/components/ui';
import { Icon } from '@/components/Icon';

interface RequiredDoc {
  key: string;
  title: string;
  version: number;
  type: string;
  checkboxText: string;
}

export function LegalGate({ active, children }: { active: boolean; children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'ok' | 'needed'>('loading');
  const [missing, setMissing] = useState<RequiredDoc[]>([]);
  const [bodies, setBodies] = useState<Record<string, string>>({});
  const [open, setOpen] = useState('');
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { pathname } = useLocation();

  useEffect(() => {
    if (!active) {
      setState('loading');
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
  }, [active]);

  // Signed out, still checking or nothing to accept: the app as usual. The public policy page
  // asks for nothing, so it stays readable before accepting.
  if (!active || state !== 'needed' || pathname === '/legal') return <>{children}</>;

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
    <main id="main" tabIndex={-1}>
      <PageHead eyebrow="Before you continue" title="Please review and accept to continue">
        These documents are new or have changed since you last accepted. You can also read our <Link to="/legal">customer policies</Link>.
      </PageHead>
      <div className="page">
        <div className="stack gate">
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
