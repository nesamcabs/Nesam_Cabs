// Notification sounds chosen in the admin panel (header → Notification sounds), kept in business_config/notification_sounds
// (firestore.rules: staff read, no client writes). What the setting means is in domain/soundEvents.ts.
//
//   notify.ts reads the app choices through `loadSoundOverrides` (cached for a minute per server instance, so a save reaches
//   every instance within a minute and a notification never waits on it). A missing or unreadable document means "no
//   choices": every notification keeps the sound it always had.
//   saveNotificationSounds is the only writer: it checks the caller, a reason and the version, keeps a change history in
//   the document and writes the shared audit trail in the same transaction.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from './admin';
import { auditInTx } from './audit';
import { cleanOffice, cleanOverrides, planSoundSave, SoundSettingsError, type SoundOverrides } from './domain/soundEvents';
import { requireAction, requirePermission, text } from './shared';

export const NOTIFICATION_SOUNDS_DOC = 'business_config/notification_sounds';
const TTL_MS = 60_000;
const HISTORY_LIMIT = 100;

let cache: { at: number; apps: SoundOverrides } | null = null;
let loading: Promise<SoundOverrides | null> | null = null;

/** The choices last read on this instance, or null before the first read (callers then keep each call site's sound). */
export function cachedSoundOverrides(): SoundOverrides | null {
  return cache?.apps ?? null;
}

/** The current choices (re-read at most once a minute). Never throws: on a read error the last known choices, else null. */
export function loadSoundOverrides(): Promise<SoundOverrides | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.apps);
  if (!loading) {
    loading = db.doc(NOTIFICATION_SOUNDS_DOC).get()
      .then((snap) => {
        const apps = cleanOverrides(snap.data()?.apps);
        cache = { at: Date.now(), apps };
        return apps;
      })
      .catch((err) => {
        console.warn('notification sounds could not be read; keeping the default sounds', err);
        return cache?.apps ?? null;
      })
      .finally(() => { loading = null; });
  }
  return loading;
}

/** Tests: forget what was read. */
export function resetSoundOverridesCache(): void {
  cache = null;
  loading = null;
}

export const saveNotificationSounds = onCall(async (request) => {
  // Notification settings are part of Engagement (notifications) · Communication, like sending notices.
  const actor = await requirePermission(request.auth, 'engagement');
  requireAction(actor, 'Communication', 'edit');
  const input = request.data ?? {};
  const reason = text(input.reason, 300);
  if (reason.length < 5) throw new HttpsError('invalid-argument', 'Write the reason for this change (at least 5 characters).');
  if (input.apps === undefined && input.office === undefined) throw new HttpsError('invalid-argument', 'Nothing to save.');

  const ref = db.doc(NOTIFICATION_SOUNDS_DOC);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.data() ?? {};
    const version = typeof cur.version === 'number' ? cur.version : 0;
    if (typeof input.expectedVersion === 'number' && input.expectedVersion !== version) {
      throw new HttpsError('failed-precondition', 'Someone else changed the notification sounds. Reopen the window, check them and save again.');
    }
    let plan: ReturnType<typeof planSoundSave>;
    try {
      plan = planSoundSave({ apps: cleanOverrides(cur.apps), office: cleanOffice(cur.office) }, { apps: input.apps, office: input.office });
    } catch (err) {
      if (err instanceof SoundSettingsError) throw new HttpsError('invalid-argument', err.message);
      throw err;
    }
    if (!plan.changes.length) throw new HttpsError('failed-precondition', 'Nothing has changed.');
    const changes = plan.changes.slice(0, 60);
    const entry = { at: Timestamp.now(), byUid: actor.uid, byName: actor.name, reason, changes };
    const history = Array.isArray(cur.history) ? cur.history.slice(-(HISTORY_LIMIT - 1)) : [];
    tx.set(ref, {
      version: version + 1,
      apps: plan.apps,
      office: plan.office,
      history: [...history, entry],
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.uid,
      updatedByName: actor.name,
    });
    auditInTx(tx, {
      action: 'notification_sounds_saved', entity: 'notification_sounds', entityId: 'notification_sounds',
      performedBy: actor.uid, performedByName: actor.name, role: 'admin',
      previous: { version }, next: { version: version + 1 }, reason, meta: { changes },
    });
    return { version: version + 1, changes: changes.length, apps: plan.apps };
  });
  // This instance uses the new choices at once; the others within a minute.
  cache = { at: Date.now(), apps: result.apps };
  return { version: result.version, changes: result.changes };
});
