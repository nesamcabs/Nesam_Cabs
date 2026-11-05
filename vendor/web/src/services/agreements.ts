// The agreements this partner accepted. Acceptances are written only by the server (acceptLegalDocuments) with the
// version, time and connection details; the text shown here is the published text, and is only offered when the
// accepted version is still the one in force.
import { collection, doc, getDoc, onSnapshot, query, where, Timestamp } from 'firebase/firestore';
import { db } from './firebase';

export interface Acceptance {
  id: string;
  key: string;
  title: string;
  version: number;
  acceptedAt: Date | null;
  source: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function subscribeToMyAcceptances(uid: string, cb: (a: Acceptance[]) => void, onError: () => void) {
  return onSnapshot(
    query(collection(db, 'legal_acceptances'), where('userId', '==', uid)),
    (snap) => cb(snap.docs.map((d) => {
      const x = d.data();
      return { id: d.id, key: str(x.key), title: str(x.title) || str(x.key), version: Number(x.version) || 0, acceptedAt: x.acceptedAt instanceof Timestamp ? x.acceptedAt.toDate() : null, source: str(x.source) };
    }).sort((a, b) => (b.acceptedAt?.getTime() ?? 0) - (a.acceptedAt?.getTime() ?? 0))),
    onError,
  );
}

/** The published text of a document, if the accepted version is still the current one. */
export async function currentTextOf(a: Acceptance): Promise<{ body: string; current: boolean }> {
  const snap = await getDoc(doc(db, 'legal_documents', a.key));
  const d = snap.data();
  if (!snap.exists() || !d || d.status !== 'Published') return { body: '', current: false };
  return { body: str(d.body), current: Number(d.version) === a.version };
}
