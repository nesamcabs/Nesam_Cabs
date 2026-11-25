// Admin callables for Local Pickup & Drop / Hourly Rental location-scoped rates (geo_fares) and scheduled peak rules (peak_rules).
// Only these functions write the two collections: they check pricing access, validate every value and scope on the server, refuse
// a save against an older version, keep a change history on the record and write the shared audit trail.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from './admin';
import { auditInTx } from './audit';
import { requireAction, requirePermission, text } from './shared';
import { SUPPORTED_BRANDS } from './brandContext';
import { STATE_NAMES } from './domain/pincodeLookup';
import { districtName, scopeKey, type GeoLevel, type GeoScope } from './domain/geoScope';
import { GEO_SERVICES, LOCAL_FIELDS, RENTAL_FIELDS, geoDocId, parseValue, type GeoService } from './domain/geoFares';
import { overlappingRules, validatePeakRule, type PeakRule } from './domain/peakRules';
import { TARIFF_CLASSES, type TariffClass } from './domain/tariff';
import { isZoneRecord } from './geoPricing';

const bad = (m: string) => new HttpsError('invalid-argument', m);
const HISTORY_LIMIT = 50;
const obj = (v: unknown, what: string): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad(`${what} is missing.`);
  return v as Record<string, unknown>;
};
const brandOf = (v: unknown) => {
  const b = text(v, 40) || 'common';
  if (b !== 'common' && !(SUPPORTED_BRANDS as readonly string[]).includes(b)) throw bad('Choose a brand.');
  return b;
};
const serviceOf = (v: unknown): GeoService => {
  if (!GEO_SERVICES.includes(v as GeoService)) throw bad('Choose Local Pickup & Drop or Hourly Rental.');
  return v as GeoService;
};
const classOf = (v: unknown): TariffClass => {
  if (!(TARIFF_CLASSES as readonly string[]).includes(v as string)) throw bad('Choose a vehicle class.');
  return v as TariffClass;
};
const SERVICE_LABEL: Record<GeoService, string> = { local: 'Local Pickup & Drop', rental: 'Hourly Rental' };

/**
 * A scope from the admin page, checked against the real location data: a listed district (India Post or saved on a Locations
 * record) of a real state; an existing Service Zone record; an existing non-zone Locations record. Labels are rebuilt here.
 */
async function scopeOf(v: unknown, allowed: GeoLevel[]): Promise<GeoScope & { locationType?: string }> {
  const s = obj(v, 'The location');
  const level = s.level as GeoLevel;
  if (!allowed.includes(level)) throw bad('Choose where this applies.');
  if (level === 'all') return { level, state: '', district: '', label: 'All locations' };
  const state = text(s.state, 2);
  if (!STATE_NAMES[state]) throw bad('Choose a state.');
  if (level === 'state') return { level, state, district: '', label: STATE_NAMES[state] };
  if (level === 'district') {
    const raw = text(s.district, 80);
    let district = districtName(state, raw);
    if (!district && raw) {
      const saved = await db.collection('locations').where('district', '==', raw).limit(1).get();
      if (!saved.empty) district = raw;
    }
    if (!district) throw bad('Choose a district of the selected state.');
    return { level, state, district, label: `${district}, ${STATE_NAMES[state]}` };
  }
  const id = text(level === 'zone' ? s.zoneId : s.locationId, 128);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw bad('Choose a location.');
  const snap = await db.doc(`locations/${id}`).get();
  const l = snap.data();
  if (!snap.exists || !l) throw bad('That location no longer exists. Reload and choose again.');
  if (level === 'zone' && !isZoneRecord(l)) throw bad('That location is not a service zone.');
  if (level === 'area' && isZoneRecord(l)) throw bad('Choose an area, city or village, not a service zone.');
  const district = text(s.district, 80);
  return { level, state, district, ...(level === 'zone' ? { zoneId: id } : { locationId: id }), label: String(l.name ?? id), locationType: String(l.type ?? '') };
}

type Patch = Record<string, number | null>;
/** One party's / package's changed fields: only the fields sent are touched; null removes the override. */
function patchOf(v: unknown, fields: readonly string[], what: string): Patch {
  const p = obj(v, what);
  const out: Patch = {};
  for (const [k, val] of Object.entries(p)) {
    if (!fields.includes(k)) throw bad(`${what}: unknown field ${k}.`);
    try { out[k] = parseValue(k, val, `${what} ${k}`); } catch (e) { throw bad((e as Error).message); }
  }
  return out;
}
function applyPatch(target: Record<string, unknown> | undefined, patch: Patch): Record<string, unknown> {
  const next = { ...(target ?? {}) };
  for (const [k, v] of Object.entries(patch)) { if (v === null) delete next[k]; else next[k] = v; }
  return next;
}
const prune = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && !(v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)));

/**
 * Saves location-scoped rates. `targets` are one or more scopes (bulk edit): the same changed fields are written to every target,
 * nothing else of a target changes, so one area's whole tariff is never copied onto the others.
 */
export const saveGeoFares = onCall(async (request) => {
  const actor = await requirePermission(request.auth, 'pricing');
  requireAction(actor, 'Settings', 'edit');
  const input = request.data ?? {};
  const reason = text(input.reason, 300);
  if (reason.length < 5) throw bad('Give a short reason for the change.');
  const brand = brandOf(input.brand);
  const service = serviceOf(input.service);
  const rawTargets = Array.isArray(input.targets) ? input.targets : [];
  if (!rawTargets.length || rawTargets.length > 200) throw bad('Choose one to 200 locations.');
  const targets = await Promise.all(rawTargets.map((t: unknown) => scopeOf(t, ['district', 'zone', 'area'])));
  const data = obj(input.data, 'The rates');
  const classes = obj(data.classes ?? {}, 'The vehicle rates');
  const changes: Record<string, Record<string, unknown>> = {};
  for (const [c, raw] of Object.entries(classes)) {
    const cls = classOf(c);
    const r = obj(raw, 'The vehicle rates');
    const out: Record<string, unknown> = {};
    if (service === 'local') {
      if (r.customer !== undefined) out.customer = patchOf(r.customer, LOCAL_FIELDS, 'Customer fare');
      if (r.partner !== undefined) out.partner = patchOf(r.partner, LOCAL_FIELDS, 'Partner payout');
    } else {
      if (r.gstMode !== undefined) {
        if (r.gstMode !== null && r.gstMode !== 'included' && r.gstMode !== 'excluded') throw bad('Choose GST included or GST added.');
        out.gstMode = r.gstMode;
      }
      if (r.packages !== undefined) {
        const pk: Record<string, Patch> = {};
        for (const [h, p] of Object.entries(obj(r.packages, 'The packages'))) {
          const hours = Number(h);
          if (!Number.isInteger(hours) || hours < 1 || hours > 15) throw bad('Packages are 1 to 15 hours.');
          pk[String(hours)] = patchOf(p, RENTAL_FIELDS, `${hours}-hour package`);
        }
        out.packages = pk;
      }
    }
    changes[cls] = out;
  }
  let airport: { customerFee: number; partnerFee: number; appliesTo: string } | null | undefined;
  if (data.airportEntry !== undefined) {
    if (service !== 'local') throw bad('Airport entry is a Local Pickup & Drop setting.');
    if (targets.some((t) => t.level !== 'area' || t.locationType !== 'Airport')) throw bad('Airport entry can be saved only for an Airport location.');
    if (data.airportEntry === null) airport = null;
    else {
      const a = obj(data.airportEntry, 'Airport entry');
      const fee = parseValue('fee', a.customerFee, 'Airport entry fee');
      // The driver pays the entry at the gate, so the partner is reimbursed the same fee unless a different amount is sent.
      const pFee = a.partnerFee === undefined ? fee : parseValue('fee', a.partnerFee, 'Partner airport entry');
      if (fee === null || pFee === null) throw bad('Enter the airport entry fee and the partner reimbursement.');
      if (!['pickup', 'drop', 'both'].includes(a.appliesTo as string)) throw bad('Choose when the airport entry applies.');
      airport = { customerFee: fee, partnerFee: pFee, appliesTo: a.appliesTo as string };
    }
  }
  if (!Object.keys(changes).length && airport === undefined) throw bad('Nothing to save.');
  const expected = (input.expected && typeof input.expected === 'object' ? input.expected : {}) as Record<string, unknown>;

  const refs = targets.map((t) => db.doc(`geo_fares/${geoDocId(brand, service, scopeKey(t))}`));
  return db.runTransaction(async (tx) => {
    const snaps = await tx.getAll(...refs);
    const saved: { id: string; version: number }[] = [];
    snaps.forEach((snap, n) => {
      const t = targets[n]!;
      const before = snap.data() as { version?: number; classes?: Record<string, Record<string, unknown>>; history?: unknown[]; airportEntry?: unknown; createdAt?: unknown; createdBy?: string } | undefined;
      const version = before?.version ?? 0;
      if (typeof expected[snap.id] === 'number' && expected[snap.id] !== version) throw new HttpsError('failed-precondition', `The rates for ${t.label} were changed by someone else. Reload and review them before saving.`);
      const classesNext: Record<string, Record<string, unknown>> = { ...(before?.classes ?? {}) };
      for (const [cls, ch] of Object.entries(changes)) {
        const cur = { ...(classesNext[cls] ?? {}) } as Record<string, unknown>;
        if (ch.customer) cur.customer = applyPatch(cur.customer as Record<string, unknown>, ch.customer as Patch);
        if (ch.partner) cur.partner = applyPatch(cur.partner as Record<string, unknown>, ch.partner as Patch);
        if (ch.gstMode !== undefined) cur.gstMode = ch.gstMode === null ? undefined : ch.gstMode;
        if (ch.packages) {
          const pk = { ...((cur.packages as Record<string, Record<string, unknown>>) ?? {}) };
          for (const [h, p] of Object.entries(ch.packages as Record<string, Patch>)) pk[h] = applyPatch(pk[h], p);
          cur.packages = prune(pk);
        }
        const clean = prune(cur);
        if (Object.keys(clean).length) classesNext[cls] = clean; else delete classesNext[cls];
      }
      const entry = { at: Timestamp.now(), byUid: actor.uid, byName: actor.name, reason, changes: JSON.stringify({ classes: changes, ...(airport !== undefined ? { airportEntry: airport } : {}) }).slice(0, 4000) };
      const { locationType: _t, ...scope } = t;
      tx.set(snap.ref, {
        brand, service, scopeKey: scopeKey(t), scope: prune(scope as Record<string, unknown>), classes: classesNext,
        ...(airport !== undefined ? (airport ? { airportEntry: airport } : {}) : before?.airportEntry ? { airportEntry: before.airportEntry } : {}),
        version: version + 1, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid, updatedByName: actor.name,
        history: [...(before?.history ?? []).slice(-(HISTORY_LIMIT - 1)), entry],
        createdAt: before?.createdAt ?? FieldValue.serverTimestamp(), createdBy: before?.createdBy ?? actor.uid,
      });
      saved.push({ id: snap.id, version: version + 1 });
    });
    auditInTx(tx, {
      action: 'geo_fares_saved', entity: 'geo_fares', entityId: saved.map((s) => s.id).join(',').slice(0, 500), performedBy: actor.uid, performedByName: actor.name, role: 'admin', reason,
      next: { brand, service: SERVICE_LABEL[service], places: targets.map((t) => t.label), classes: Object.keys(changes), airportEntry: airport },
    });
    return { saved };
  });
});

const days = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((d) => Number.isInteger(d)))] as number[] : []);
const slots = (v: unknown) => (Array.isArray(v) ? v.slice(0, 6).map((s) => ({ start: text((s as { start?: unknown })?.start, 5), end: text((s as { end?: unknown })?.end, 5) })) : []);
const optNum = (v: unknown) => (v === null || v === undefined || v === '' ? undefined : Number(v));

/** Creates, edits, switches on / off or removes a scheduled peak rule. Overlapping rules of the same priority are refused. */
export const savePeakRule = onCall(async (request) => {
  const actor = await requirePermission(request.auth, 'pricing');
  requireAction(actor, 'Settings', 'edit');
  const input = request.data ?? {};
  const reason = text(input.reason, 300);
  if (reason.length < 5) throw bad('Give a short reason for the change.');
  const id = text(input.id, 128);
  if (id && !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw bad('Unknown peak rule.');
  const remove = input.remove === true;
  const brandKey = brandOf(input.brand);
  const brand = brandKey === 'common' ? '' : brandKey;
  const service = serviceOf(input.service);
  const scope = remove ? null : await scopeOf(input.scope, ['all', 'state', 'district', 'zone', 'area']);
  const rule = remove ? null : {
    brand, service, scopeKey: scopeKey(scope!), name: text(input.name, 80), enabled: input.enabled === true, days: days(input.days), slots: slots(input.slots),
    from: text(input.from, 10), until: text(input.until, 10), type: input.type === 'fixed' ? 'fixed' as const : 'percent' as const,
    value: Number(input.value), ...(optNum(input.cap) !== undefined ? { cap: optNum(input.cap)! } : {}), priority: Number(input.priority),
  };
  if (rule) {
    if (!rule.name) throw bad('Give the rule a name.');
    try { validatePeakRule(rule); } catch (e) { throw bad((e as Error).message); }
  }
  const ref = id ? db.doc(`peak_rules/${id}`) : db.collection('peak_rules').doc();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const before = snap.data() as (PeakRule & { history?: unknown[]; status?: string; createdAt?: unknown; createdBy?: string }) | undefined;
    if (id && !snap.exists) throw bad('That peak rule no longer exists.');
    const version = before?.version ?? 0;
    if (id && input.expectedVersion !== version) throw new HttpsError('failed-precondition', 'This peak rule was changed by someone else. Reload and review it before saving.');
    if (rule?.enabled) {
      const others = (await tx.get(db.collection('peak_rules').where('service', '==', service).where('enabled', '==', true))).docs
        .map((d) => ({ ...(d.data() as Omit<PeakRule, 'id'>), id: d.id })).filter((r) => (r as { status?: string }).status !== 'Removed');
      const clash = overlappingRules({ ...rule, id: ref.id }, others);
      if (clash.length) throw new HttpsError('failed-precondition', `Overlaps “${clash.map((c) => c.name || c.id).join('”, “')}” at the same place and priority. Change the days, times, dates or priority so one rule applies.`);
    }
    const entry = { at: Timestamp.now(), byUid: actor.uid, byName: actor.name, reason, action: remove ? 'Removed' : before ? 'Edited' : 'Created' };
    if (remove) {
      tx.update(ref, { enabled: false, status: 'Removed', version: version + 1, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid, history: [...(before?.history ?? []).slice(-(HISTORY_LIMIT - 1)), entry] });
    } else {
      const { locationType: _t, ...cleanScope } = scope!;
      tx.set(ref, {
        ...rule, scope: prune(cleanScope as Record<string, unknown>), status: 'Active', version: version + 1, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid, updatedByName: actor.name,
        history: [...(before?.history ?? []).slice(-(HISTORY_LIMIT - 1)), entry], createdAt: before?.createdAt ?? FieldValue.serverTimestamp(), createdBy: before?.createdBy ?? actor.uid,
      });
    }
    auditInTx(tx, {
      action: remove ? 'peak_rule_removed' : before ? 'peak_rule_edited' : 'peak_rule_created', entity: 'peak_rule', entityId: ref.id, performedBy: actor.uid, performedByName: actor.name, role: 'admin', reason,
      previous: before ? { name: before.name, enabled: before.enabled, type: before.type, value: before.value, days: before.days, slots: before.slots } : null,
      next: rule ? { ...rule, place: scope!.label } : { status: 'Removed' },
    });
    return { id: ref.id, version: version + 1 };
  });
});
