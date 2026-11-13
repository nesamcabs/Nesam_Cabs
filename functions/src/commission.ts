// The older platform commission policy (business_config/commission). There is no screen or function to set it any more:
// partner payouts come from the partner rates in Service & Fare Settings. A policy that was saved earlier is still read, so
// trips created under it keep their stored rate and category-engine duties keep their offer.
import { Transaction } from 'firebase-admin/firestore';
import { db } from './admin';
import { CommissionPolicy, parseCommissionPolicy } from './domain/finance';

export const COMMISSION_DOC = 'business_config/commission';

export async function loadCommissionPolicy(tx?: Transaction): Promise<CommissionPolicy | null> {
  const ref = db.doc(COMMISSION_DOC);
  const snap = tx ? await tx.get(ref) : await ref.get();
  return snap.exists ? parseCommissionPolicy(snap.data()) : null;
}
