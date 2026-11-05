// Terms & privacy: the customer documents NESAM has published, the version in force and
// whether this account has accepted it (acceptance itself happens in LegalGate when a new
// version is published).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/platform/firebase';
import { callFunction } from '@core/services/callables';
import { SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '@core/config/constants';
import { Badge, Button, Notice, PageHead, PageLoader } from '@/components/ui';
import { AccountLayout } from '@/components/AccountLayout';
import { Icon } from '@/components/Icon';
import { useSeo } from '@/lib/seo';
import { useAuth } from '@/state/Auth';
import { PolicySections } from './PolicySections';

interface DocRow {
  key: string;
  title: string;
  version: number;
  body: string;
  accepted: boolean;
}

export function LegalPage() {
  useSeo({
    title: 'Terms of Service & Customer Privacy Policy',
    description: 'Read the official terms and conditions, customer privacy policy, fare transparency rules and cancellation guidelines for NESAM Cabs.',
    canonical: '/legal',
  });
  const [rows, setRows] = useState<DocRow[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState('');
  const [attempt, setAttempt] = useState(0);
  // Published agreement versions and acceptance belong to an account; a signed-out visitor reads the public policies only.
  const { state: auth } = useAuth();
  const signedIn = auth.status !== 'signed-out' && auth.status !== 'loading';

  useEffect(() => {
    if (!signedIn) return undefined;
    let alive = true;
    setError('');
    (async () => {
      try {
        const s = await callFunction<unknown, { missing: { key: string }[]; required: { key: string; title: string; version: number }[] }>('getLegalStatus', { role: 'customer' });
        const missing = new Set(s.missing.map((m) => m.key));
        const bodies = await Promise.all(s.required.map(async (r) => String((await getDoc(doc(db, 'legal_documents', r.key))).data()?.body ?? '')));
        if (!alive) return;
        const list = s.required.map((r, i) => ({ key: r.key, title: r.title || r.key, version: r.version, body: bodies[i] ?? '', accepted: !missing.has(r.key) }));
        setRows(list);
        if (list.length === 1) setOpen(list[0]!.key);
      } catch {
        if (alive) setError('We couldn’t load the documents. Check your connection and try again.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [attempt, signedIn]);

  return (
    <AccountLayout>
      <PageHead backTo="/account" title="Terms & privacy">
        The agreements and policies that apply when you travel with NESAM.
      </PageHead>

      <div className="split">
        <div className="stack">
          <PolicySections />
          {error ? (
            <Notice
              tone="error"
              action={
                <Button size="sm" variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
                  Try again
                </Button>
              }
            >
              {error}
            </Notice>
          ) : null}
          {!signedIn ? <Notice>Sign in to see the agreement versions published for your account and whether you have accepted them.</Notice> : null}
          {signedIn && rows === null && !error ? <PageLoader label="Loading documents…" /> : null}

          {rows?.map((r) => (
            <section key={r.key} className="card legal-doc">
              <button type="button" className="legal-doc__head" aria-expanded={open === r.key} onClick={() => setOpen(open === r.key ? '' : r.key)}>
                <span>
                  <strong>{r.title}</strong>
                  <small className="muted"> Version {r.version}</small>
                </span>
                <span className="legal-doc__right">
                  <Badge tone={r.accepted ? 'green' : 'amber'}>{r.accepted ? 'Accepted' : 'Not yet accepted'}</Badge>
                  <Icon name={open === r.key ? 'chevron-up' : 'chevron-down'} />
                </span>
              </button>
              {open === r.key ? <div className="legal-doc__body">{r.body || 'This document has no text yet.'}</div> : null}
            </section>
          ))}
        </div>

        <aside className="split__aside">
          <div className="aside-card">
            <h2>Questions about these terms?</h2>
            <p className="muted">Our team can walk you through cancellation, payment and privacy terms.</p>
            <a className="btn btn--secondary btn--block" href={`tel:${SUPPORT_PHONE}`}>
              <Icon name="phone" size={17} /> Call {SUPPORT_PHONE_DISPLAY}
            </a>
            <Link className="btn btn--text" to="/about">
              About NESAM <Icon name="arrow-right" size={14} />
            </Link>
          </div>
        </aside>
      </div>
    </AccountLayout>
  );
}
