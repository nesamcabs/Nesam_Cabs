import React, { useCallback, useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { Loader2, ScrollText } from 'lucide-react';
import { db } from '../services/firebase';
import { callFunction, ActionError } from '../services/callables';

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
 * Stops the app until the signed-in person has accepted the current published
 * terms, privacy policy and consents for their role (a new version asks again).
 * If nothing is published, or the status can't be read, it lets them through.
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

  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F7F7F7]" role="status">
        <Loader2 className="w-7 h-7 text-[#E21E26] animate-spin" />
      </div>
    );
  }
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
    <div className="min-h-screen bg-[#F7F7F7] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xl w-full max-w-2xl max-h-[calc(100vh-2rem)] flex flex-col" role="dialog" aria-modal="true" aria-label="Terms and privacy">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-3">
          <ScrollText className="w-6 h-6 text-[#E21E26]" />
          <div>
            <h1 className="text-lg font-black text-gray-900">Please review and accept to continue</h1>
            <p className="text-sm text-gray-700">These documents are new or have changed since you last accepted.</p>
          </div>
        </div>
        <div className="px-6 py-4 overflow-y-auto space-y-3">
          {missing.map((m) => (
            <details key={m.key} className="border border-gray-300 rounded-xl" open={missing.length === 1}>
              <summary className="px-4 py-3 text-sm font-bold cursor-pointer text-gray-900">{m.title} <span className="font-normal text-gray-600">· version {m.version}</span></summary>
              <pre className="px-4 pb-4 text-sm text-gray-800 whitespace-pre-wrap font-sans max-h-72 overflow-auto">{bodies[m.key] || 'Loading…'}</pre>
            </details>
          ))}
          {error && <div role="alert" className="bg-red-50 border border-red-200 text-red-800 text-sm font-semibold p-3 rounded-xl">{error}</div>}
        </div>
        <div className="px-6 py-4 border-t border-gray-200 space-y-3">
          <label className="flex items-start gap-2 text-sm font-semibold text-gray-900">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="w-5 h-5 mt-0.5 accent-[#E21E26]" />
            <span>{text}</span>
          </label>
          <button onClick={() => void accept()} disabled={!checked || busy} className="w-full sm:w-auto px-8 py-3 bg-[#E21E26] text-white text-sm font-extrabold rounded-xl disabled:opacity-50">
            {busy ? 'Saving…' : 'Accept and continue'}
          </button>
        </div>
      </div>
    </div>
  );
};
