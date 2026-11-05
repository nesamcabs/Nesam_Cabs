import React, { useCallback, useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { callFunction, ActionError } from '../services/callables';
import { Banner, Button, Loader } from '../ui/kit';
import { Icon, IconSprite } from '../ui/Icon';

interface RequiredDoc {
  key: string;
  title: string;
  version: number;
  type: string;
  checkboxText: string;
}

interface Props {
  role: 'driver' | 'vendor' | 'customer';
  children: React.ReactNode;
}

/**
 * Stops the app until the signed-in person has accepted the current published terms, privacy policy and consents for their
 * role (a new version asks again). If nothing is published, or the status can't be read, it lets them through.
 */
export const LegalGate: React.FC<Props> = ({ role, children }) => {
  const [state, setState] = useState<'loading' | 'ok' | 'needed'>('loading');
  const [missing, setMissing] = useState<RequiredDoc[]>([]);
  const [bodies, setBodies] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const s = await callFunction<unknown, { missing: RequiredDoc[] }>('getLegalStatus', { role });
      if (!s.missing.length) return setState('ok');
      setMissing(s.missing);
      const entries = await Promise.all(s.missing.map(async (m) => [m.key, String((await getDoc(doc(db, 'legal_documents', m.key))).data()?.body ?? '')] as const));
      setBodies(Object.fromEntries(entries));
      setState('needed');
    } catch {
      // Not being able to read the status must not lock the person out.
      setState('ok');
    }
  }, [role]);
  useEffect(() => { void load(); }, [load]);

  if (state === 'loading') return <div className="vx"><Loader label="Checking your agreements…" /></div>;
  if (state === 'ok') return <>{children}</>;

  const text = missing.find((m) => m.checkboxText)?.checkboxText || 'I agree to the Terms & Conditions and Privacy Policy.';
  const accept = async () => {
    setBusy(true);
    setError('');
    try {
      await callFunction('acceptLegalDocuments', {
        role, confirmed: true, accept: missing.map((m) => ({ key: m.key, version: m.version })), checkboxText: text, source: `${role}_web`,
        device: { platform: 'web', appVersion: 'web' },
      });
      setState('ok');
    } catch (err) {
      setError(err instanceof ActionError ? err.message : 'Could not record your acceptance. Try again.');
      setBusy(false);
    }
  };

  return (
    <div className="vx">
      <IconSprite />
      <div className="vx-auth">
        <div className="vx-auth__col" style={{ maxWidth: 640 }} role="dialog" aria-modal="true" aria-label="Agreements">
          <div className="vx-card">
            <div className="vx-media" style={{ marginBottom: 14 }}>
              <span className="vx-avatar vx-avatar--lg"><Icon name="filecheck" /></span>
              <div>
                <strong style={{ fontSize: 18 }}>Review and accept to continue</strong>
                <small>These documents are new or have changed since you last accepted.</small>
              </div>
            </div>
            {missing.map((m) => (
              <details key={m.key} className="vx-found" open={missing.length === 1} style={{ background: '#fff' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{m.title} <span className="vx-muted" style={{ fontWeight: 400 }}>· version {m.version}</span></summary>
                <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.7, maxHeight: 280, overflow: 'auto', margin: '10px 0 0' }}>{bodies[m.key] || 'Loading…'}</pre>
              </details>
            ))}
            {error && <Banner tone="err">{error}</Banner>}
            <label className="vx-check" style={{ margin: '14px 0' }}>
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /><span>{text}</span>
            </label>
            <Button variant="primary" block loading={busy} disabled={!checked} onClick={() => void accept()}>{busy ? 'Saving…' : 'Accept and continue'}</Button>
          </div>
        </div>
      </div>
    </div>
  );
};
