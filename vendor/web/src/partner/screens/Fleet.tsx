// Fleet — "Drivers and vehicles. One permanent ID each." (reference vVehicles / wFleetCard / entity, documents,
// availability sheets, Add vehicle / Add driver lookup, Linking requests, Documents & verification).
import React, { useState } from 'react';
import { getDownloadURL, ref } from 'firebase/storage';
import { storage } from '../../services/firebase';
import { usePartner, linkIsOpen } from '../../state/Partner';
import type { FleetDriver, FleetVehicle } from '../../types';
import {
  askOfficeForHelp, cancelLink, findDriver, findVehicle, requestDriverLink, requestVehicleLink, resendLinkCode, revokeInvite, verifyLinkCode,
  type DriverLookup, type PartnerLink, type VehicleLookup,
} from '../../services/partnerLinks';
import { uploadVendorFile } from '../../services/storageService';
import type { UploadCategory } from '../../config/onboarding';
import { Icon } from '../Icon';
import { Badge, Btn, Check, DateTime12, Dialog, Empty, ErrorLine, Field, KV, Notice, PageHeading, Tabs } from '../ui';
import { carCode, dayTime, driverCode, initials, maskPhone, plate } from '../format';
import {
  VEHICLE_DOCS, carImage, docKind, driverDocState, dutyLine, shortDate, stageOf, vehicleDocState, vehicleValidUntil, type DocState,
} from '../derive';
import { setVehicleAvailability, submitRenewal } from '../services';
import { useWorkspace } from '../Workspace';
import { isPlate, normalizePlate } from '../../utils/fleet';

type FleetTab = 'Vehicles' | 'Drivers';
const STATUSES = ['All', 'Active', 'Inactive', 'Suspended', 'Pending', 'Rejected', 'Expired', 'Dispute'];

const vehicleStatus = (v: FleetVehicle) => (v.status === 'Active' ? 'Active' : v.status === 'Inactive' ? 'Inactive' : v.status);
const driverStatus = (d: FleetDriver) => (d.suspended ? 'Suspended' : d.accountStatus === 'Approved' ? 'Active' : 'Pending');
const verifyLabel = (s: DocState) => (s === 'Verified' ? 'Verified' : s === 'Expiring' ? 'Expiring soon' : s);

function matchesStatus(filter: string, status: string, doc: DocState, dispute: boolean): boolean {
  if (filter === 'All') return true;
  if (filter === 'Dispute') return dispute;
  if (filter === 'Expired') return doc === 'Expired';
  if (filter === 'Rejected') return doc === 'Rejected';
  if (filter === 'Pending') return doc === 'Pending' || status === 'Pending';
  return status === filter;
}

export const FleetScreen: React.FC<{ initialTab?: string }> = ({ initialTab }) => {
  const p = usePartner();
  const ws = useWorkspace();
  const [tab, setTab] = useState<FleetTab>(initialTab === 'Drivers' ? 'Drivers' : 'Vehicles');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All');
  const [entity, setEntity] = useState<null | { kind: 'car' | 'driver'; id: string }>(null);
  const q = search.trim().toLowerCase();
  const disputed = new Set(p.links.filter((l) => l.status === 'Office review').map((l) => l.subjectId));

  const vehicles = p.vehicles
    .filter((v) => !q || `${v.vehicleNumber} ${plate(v.vehicleNumber)} ${carCode(v.id, v.code)} ${v.make} ${v.model}`.toLowerCase().includes(q))
    .filter((v) => matchesStatus(status, vehicleStatus(v), vehicleDocState(v), disputed.has(v.id)));
  const drivers = p.drivers
    .filter((d) => !q || `${d.name} ${d.phone} ${d.licenseNumber} ${driverCode(d.id, d.code)}`.toLowerCase().includes(q))
    .filter((d) => matchesStatus(status, driverStatus(d), driverDocState(d), disputed.has(d.id)));
  const openLinks = p.links.filter(linkIsOpen).length;

  return (
    <>
      <PageHeading title="Fleet" subtitle="Drivers and vehicles. One permanent ID each."
        action={<Btn icon="plus" onClick={() => ws.open({ kind: 'add', what: tab === 'Drivers' ? 'driver' : 'car' })}>{tab === 'Drivers' ? 'Add driver' : 'Add vehicle'}</Btn>} />
      <Tabs value={tab} onChange={setTab} items={[{ id: 'Vehicles', label: 'Vehicles', count: p.vehicles.length }, { id: 'Drivers', label: 'Drivers', count: p.drivers.length }]} />
      <div className="v-toolbar w-fleet-toolbar">
        <label className="v-search"><Icon name="search" />
          <input id="w-fleet-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)}
            aria-label={tab === 'Drivers' ? 'Search name, mobile, DL or Driver ID' : 'Search registration, Car ID or model'}
            placeholder={tab === 'Drivers' ? 'Name, mobile, DL or Driver ID' : 'Registration, Car ID or model'} />
        </label>
        <label className="v-service"><span className="v-sr">Fleet status</span>
          <select id="w-fleet-status" value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
        </label>
      </div>
      <div className="w-section-line">
        <span>{tab === 'Drivers' ? `${drivers.length} driver${drivers.length === 1 ? '' : 's'}` : `${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'}`}</span>
        <Btn style="text" icon="chevron-right" onClick={() => ws.open({ kind: 'linking' })}>{openLinks ? `Linking requests (${openLinks})` : 'Linking requests'}</Btn>
      </div>
      {tab === 'Vehicles' ? (
        vehicles.length ? (
          <div className="v-card-grid">
            {vehicles.map((v) => {
              const doc = vehicleDocState(v);
              const until = vehicleValidUntil(v);
              return (
                <article key={v.id} className="v-panel w-fleet-card" data-entity={v.vehicleNumber}>
                  <div className="v-between"><span className="v-eyebrow">{carCode(v.id, v.code)}</span><span className="w-kind-label">{v.category || 'Category pending'}</span></div>
                  <div className="v-car-heading">
                    <div>
                      <h2>{plate(v.vehicleNumber)}</h2>
                      <p>{[v.make, v.model].filter(Boolean).join(' ') || 'Model not recorded'}</p>
                      <p className="m-fleet-capacity">{v.seatingCapacity ? `${v.seatingCapacity} passengers · driver excluded` : 'Passenger capacity: RC verification pending'}</p>
                    </div>
                    <img src={carImage(v)} alt={`${[v.make, v.model].filter(Boolean).join(' ') || v.category}`} />
                  </div>
                  <div className="w-status-badges">
                    <Badge>{vehicleStatus(v)}</Badge>
                    <Badge kind={docKind(doc)}>{verifyLabel(doc)}</Badge>
                    <Badge kind={disputed.has(v.id) ? 'amber' : 'neutral'}>{disputed.has(v.id) ? 'Dispute' : 'Linked'}</Badge>
                  </div>
                  <p className="v-document-date">{doc === 'Rejected' && v.rejectionReason ? v.rejectionReason : until ? `Documents valid until ${shortDate(until)}` : 'Document dates pending office verification'}</p>
                  <div className="v-between v-mt">
                    <span className="v-small v-muted">{v.status !== 'Active' ? 'Not taking duties' : doc === 'Expired' ? 'Document hold' : dutyLine(p.trips, (t) => t.vehicleId === v.id, v.assignedDriverName ? `Paired with ${v.assignedDriverName}` : 'Available for new duties')}</span>
                    <Btn style="text" icon="chevron-right" onClick={() => setEntity({ kind: 'car', id: v.id })}>View details</Btn>
                  </div>
                </article>
              );
            })}
          </div>
        ) : <Empty title={p.vehicles.length ? 'No matching vehicles' : 'No vehicles in your fleet yet'} action={<Btn icon="plus" onClick={() => ws.open({ kind: 'add', what: 'car' })}>Add vehicle</Btn>}>
          {p.vehicles.length ? 'Try another search or status.' : 'Add a vehicle to start taking duties.'}
        </Empty>
      ) : (
        <>
          {drivers.length ? (
            <div className="v-card-grid">
              {drivers.map((d) => {
                const doc = driverDocState(d);
                return (
                  <article key={d.id} className="v-panel w-fleet-card" data-entity={d.id}>
                    <div className="v-between"><span className="v-eyebrow">{driverCode(d.id, d.code)}</span><span className="w-kind-label">Vendor Driver</span></div>
                    <div className="w-fleet-driver">
                      <span className="v-avatar">{d.photoUrl ? <img src={d.photoUrl} alt="" /> : initials(d.name || '?')}</span>
                      <div><h2>{d.name || 'Name pending'}</h2><p>{maskPhone(d.phone)}</p></div>
                    </div>
                    <p className="w-dl">DL · {d.licenseNumber || 'not recorded'}</p>
                    <div className="w-status-badges">
                      <Badge>{driverStatus(d)}</Badge>
                      <Badge kind={docKind(doc)}>{verifyLabel(doc)}</Badge>
                      <Badge kind={disputed.has(d.id) ? 'amber' : 'neutral'}>{disputed.has(d.id) ? 'Dispute' : 'Linked'}</Badge>
                    </div>
                    <p className="v-document-date">{doc === 'Rejected' && d.rejectionReason ? d.rejectionReason : d.licenseExpiry ? `Documents valid until ${shortDate(d.licenseExpiry)}` : 'Licence date pending office verification'}</p>
                    <div className="v-between v-mt">
                      <span className="v-small v-muted">{dutyLine(p.trips, (t) => t.driverId === d.id, d.online ? 'Online · linked to your business' : 'Linked to your business')}</span>
                      <Btn style="text" icon="chevron-right" onClick={() => setEntity({ kind: 'driver', id: d.id })}>View details</Btn>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : <Empty title={p.drivers.length ? 'No matching drivers' : 'No drivers in your fleet yet'} action={<Btn icon="plus" onClick={() => ws.open({ kind: 'add', what: 'driver' })}>Add driver</Btn>}>
            {p.drivers.length ? 'Try another search or status.' : 'Invite or link a driver to dispatch duties.'}
          </Empty>}
          {p.invites.length ? (
            <section className="v-panel v-mt">
              <h2>Invitations waiting for sign-up</h2>
              <p className="v-small v-muted v-mt">The driver signs in to the NESAM Driver app with this number and completes the selfie and licence checks.</p>
              {p.invites.map((i) => (
                <div key={i.phone} className="w-history-row">
                  <span>{maskPhone(i.phone)}<small>{i.vehicleAssignment ? `Vehicle ${plate(i.vehicleAssignment)} · ` : ''}{dayTime(i.createdAt)}</small></span>
                  <Btn style="text" icon="x" onClick={() => { revokeInvite(i.phone).then(() => ws.say('Invitation withdrawn.'), (e: Error) => ws.fail(e.message)); }}>Withdraw</Btn>
                </div>
              ))}
            </section>
          ) : null}
        </>
      )}
      {entity ? <EntitySheet kind={entity.kind} id={entity.id} onClose={() => setEntity(null)} /> : null}
    </>
  );
};

const EntitySheet: React.FC<{ kind: 'car' | 'driver'; id: string; onClose: () => void }> = ({ kind, id, onClose }) => {
  const p = usePartner();
  const ws = useWorkspace();
  const [sheet, setSheet] = useState<'' | 'documents' | 'availability'>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const v = kind === 'car' ? p.vehicles.find((x) => x.id === id) : undefined;
  const d = kind === 'driver' ? p.drivers.find((x) => x.id === id) : undefined;
  if (!v && !d) return null;
  const history = p.trips.filter((t) => (v ? t.vehicleId === v.id : t.driverId === d!.id)).sort((a, b) => (b.pickupAt?.getTime() ?? 0) - (a.pickupAt?.getTime() ?? 0)).slice(0, 8);
  const busyDuty = history.find((t) => stageOf(t) === 'Upcoming' || stageOf(t) === 'On Trip');

  const run = async (work: () => Promise<void>, done: string) => {
    setBusy(true); setError('');
    try { await work(); ws.say(done); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  if (sheet === 'documents') return <DocumentsSheet kind={kind} id={id} onClose={() => setSheet('')} />;
  if (sheet === 'availability' && v) return <AvailabilitySheet vehicle={v} onClose={() => setSheet('')} />;

  const doc = v ? vehicleDocState(v) : driverDocState(d!);
  return (
    <Dialog title={v ? 'Vehicle details' : 'Driver details'} onClose={onClose} busy={busy}>
      <ErrorLine message={error} />
      <h3 className="v-modal-route">{v ? plate(v.vehicleNumber) : d!.name}</h3>
      <div className="w-status-badges">
        <Badge>{v ? vehicleStatus(v) : driverStatus(d!)}</Badge>
        <Badge kind={docKind(doc)}>{verifyLabel(doc)}</Badge>
        <Badge>Linked</Badge>
      </div>
      {v ? (
        <KV mt rows={[
          ['Permanent ID', carCode(v.id, v.code)], ['Make', v.make || '—'], ['Model', v.model || '—'], ['Category', v.category || '—'],
          ['Passenger capacity', v.seatingCapacity ? `${v.seatingCapacity} · driver excluded` : 'RC verification pending'],
          ['Documents valid until', shortDate(vehicleValidUntil(v)) || '—'],
          ['Paired driver', v.assignedDriverName || 'None'],
          ...(v.availableFrom ? [['Available from', `${dayTime(v.availableFrom)}${v.availabilityLocation ? ` · ${v.availabilityLocation}` : ''}`] as [string, string]] : []),
          ['Current attachment', p.profile.companyName],
        ]} />
      ) : (
        <KV mt rows={[
          ['Permanent ID', driverCode(d!.id, d!.code)], ['Mobile', maskPhone(d!.phone)], ['DL number', d!.licenseNumber || '—'], ['Account role', 'Vendor Driver'],
          ['Documents valid until', shortDate(d!.licenseExpiry) || '—'], ['Paired vehicle', d!.assignedVehicleNumber ? plate(d!.assignedVehicleNumber) : 'None'],
          ...(d!.rating ? [['Rating', `${d!.rating.toFixed(1)} ★`] as [string, string]] : []),
          ['Current attachment', p.profile.companyName],
        ]} />
      )}
      <div className="v-action-row v-mt">
        <Btn style="secondary" icon="file-check" onClick={() => setSheet('documents')}>Documents / renew</Btn>
        {v ? <Btn style="secondary" icon="clock-3" onClick={() => setSheet('availability')}>Availability</Btn> : null}
        {v ? (
          v.status === 'Active'
            ? <Btn style="secondary" icon="circle-pause" disabled={!!busyDuty} onClick={() => run(() => p.actions.setVehicleStatus(v.id, 'Inactive'), `${plate(v.vehicleNumber)} marked inactive.`)}>Mark inactive</Btn>
            : <Btn style="secondary" icon="circle-play" onClick={() => run(() => p.actions.setVehicleStatus(v.id, 'Active'), `${plate(v.vehicleNumber)} is active again.`)}>Mark active</Btn>
        ) : (
          d!.suspended
            ? <Btn style="secondary" icon="circle-play" onClick={() => run(() => p.actions.setSuspended(d!.id, false), `${d!.name} can take duties again.`)}>Mark active</Btn>
            : <Btn style="secondary" icon="circle-pause" disabled={!!busyDuty} onClick={() => run(() => p.actions.setSuspended(d!.id, true), `${d!.name} marked inactive for your fleet.`)}>Mark inactive</Btn>
        )}
      </div>
      {busyDuty ? <p className="v-small v-muted v-mt">This ID has an assigned or running duty ({busyDuty.bookingId}). Resolve it before changing availability.</p> : null}
      <PairPanel vehicle={v} driver={d} onDone={(m) => ws.say(m)} onError={setError} />
      <section className="w-history-section">
        <h3>Duty history with your business</h3>
        {history.length ? history.map((t) => (
          <div key={t.id} className="w-history-row">
            <span>{t.bookingId}<small>{t.pickupLabel || t.pickupAddress} → {t.dropLabel || t.dropAddress}</small></span>
            <Badge kind={stageOf(t) === 'Completed' ? 'green' : 'neutral'}>{stageOf(t) === 'Upcoming' ? 'Driver assigned' : stageOf(t)}</Badge>
          </div>
        )) : <p className="v-small v-muted">No duties yet.</p>}
        <p className="v-small v-muted v-mt">Previous records stay attached to the same ID. Other partners’ customer and financial records remain in their accounts.</p>
      </section>
    </Dialog>
  );
};

/** Default pairing of a driver and a vehicle (kept from the earlier portal; dispatch still picks per duty). */
const PairPanel: React.FC<{ vehicle?: FleetVehicle; driver?: FleetDriver; onDone: (m: string) => void; onError: (m: string) => void }> = ({ vehicle, driver, onDone, onError }) => {
  const p = usePartner();
  const [busy, setBusy] = useState(false);
  const current = vehicle ? vehicle.assignedDriverId : driver!.assignedVehicleId;
  const save = async (otherId: string) => {
    setBusy(true);
    try {
      if (vehicle) await p.actions.pairDriver(vehicle.id, otherId);
      else {
        if (otherId) await p.actions.pairDriver(otherId, driver!.id);
        else if (driver!.assignedVehicleId) await p.actions.pairDriver(driver!.assignedVehicleId, '');
      }
      onDone(otherId ? 'Pairing saved.' : 'Pairing removed.');
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Field label={vehicle ? 'Usual driver (optional)' : 'Usual vehicle (optional)'}>
      <select value={current} disabled={busy} onChange={(e) => save(e.target.value)}>
        <option value="">Not paired</option>
        {vehicle
          ? p.drivers.filter((d) => d.accountStatus === 'Approved').map((d) => <option key={d.id} value={d.id}>{d.name || d.phone}</option>)
          : p.vehicles.filter((v) => v.docStatus === 'Approved').map((v) => <option key={v.id} value={v.id}>{plate(v.vehicleNumber)} · {v.model || v.category}</option>)}
      </select>
    </Field>
  );
};

const DocumentsSheet: React.FC<{ kind: 'car' | 'driver'; id: string; onClose: () => void }> = ({ kind, id, onClose }) => {
  const p = usePartner();
  const ws = useWorkspace();
  const v = kind === 'car' ? p.vehicles.find((x) => x.id === id) : undefined;
  const d = kind === 'driver' ? p.drivers.find((x) => x.id === id) : undefined;
  const rows: [string, string, string][] = v ? VEHICLE_DOCS.map(([k, label]) => [k, label, v.expiries[k]]) : [['licence', 'Driving licence', d?.licenseExpiry ?? '']];
  const [docKey, setDocKey] = useState(rows[0]![0]);
  const [file, setFile] = useState<File | null>(null);
  const [expiry, setExpiry] = useState('');
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [error, setError] = useState('');
  const pendingRenewals = p.requests.filter((r) => r.type === 'document_renewal' && r.status === 'Pending' && r.entityName === (v ? v.vehicleNumber : d?.name));
  if (!v && !d) return null;
  const state = v ? vehicleDocState(v) : driverDocState(d!);
  const today = new Date().toISOString().slice(0, 10);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) { setError('Choose the renewed document.'); return; }
    if (!expiry || expiry <= today) { setError('Enter a new expiry date in the future.'); return; }
    setBusy(true); setError('');
    try {
      await submitRenewal(v ? 'vehicle' : 'driver', id, docKey, expiry, file, setPct);
      onClose();
      ws.say('Renewal sent. The office verifies it before the new date applies.');
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog title={`Documents · ${v ? carCode(v.id, v.code) : driverCode(d!.id, d!.code)}`} onClose={onClose} busy={busy}>
      {state === 'Verified'
        ? <Notice title="Documents verified" kind="green" icon="file-check">Assignment remains subject to every document being valid for the full trip.</Notice>
        : <Notice title={state === 'Pending' ? 'Verification pending' : state === 'Rejected' ? 'Document rejected · upload again' : state === 'Expired' ? 'Document expired' : 'Document expiring soon'} kind="amber" icon="triangle-alert">
            {state === 'Pending' ? 'NESAM verifies the documents before this ID can take duties.' : 'Renew the document below. A hold applies only to this ID.'}
          </Notice>}
      <div className="w-document-status-list">
        {rows.map(([k, label, date]) => {
          const days = date ? Math.floor((Date.parse(`${date.slice(0, 10)}T23:59:59+05:30`) - Date.now()) / 86400000) : null;
          const s = days === null ? 'Not recorded' : days < 0 ? 'Expired' : days <= 15 ? 'Expiring' : 'Valid';
          return <article key={k}><div><strong>{label}</strong><small>{date ? shortDate(date) : 'Date pending'}</small></div><Badge kind={s === 'Valid' ? 'green' : s === 'Not recorded' ? 'neutral' : 'amber'}>{s}</Badge></article>;
        })}
      </div>
      {pendingRenewals.map((r) => <Notice key={r.id} title={`${r.documentLabel} renewal under review`} icon="clock-3">New expiry {shortDate(r.expiry)} · sent {dayTime(r.requestedAt)}</Notice>)}
      <form onSubmit={submit}>
        <Field label="Document to renew">
          <select value={docKey} onChange={(e) => setDocKey(e.target.value)}>{rows.map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select>
        </Field>
        <Field label="Renewed document"><input type="file" required accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
        <Field label="New expiry date"><input type="date" required min={today} value={expiry} onChange={(e) => setExpiry(e.target.value)} /></Field>
        {busy && pct > 0 && pct < 100 ? <p className="v-small v-muted">Uploading… {pct}%</p> : null}
        <ErrorLine message={error} />
        <Btn submit full busy={busy}>Submit renewal</Btn>
      </form>
    </Dialog>
  );
};

const AvailabilitySheet: React.FC<{ vehicle: FleetVehicle; onClose: () => void }> = ({ vehicle: v, onClose }) => {
  const p = usePartner();
  const ws = useWorkspace();
  const toLocal = (d: Date | null) => (d ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
  const [from, setFrom] = useState(toLocal(v.availableFrom ?? new Date()));
  const [location, setLocation] = useState(v.availabilityLocation);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = p.trips.find((t) => t.vehicleId === v.id && (stageOf(t) === 'Upcoming' || stageOf(t) === 'On Trip'));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await setVehicleAvailability(v.id, new Date(from).toISOString(), location.trim());
      onClose();
      ws.say(`Availability updated for ${plate(v.vehicleNumber)}.`);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog title="Vehicle availability" onClose={onClose} busy={busy}>
      <p className="v-modal-intro">{plate(v.vehicleNumber)} · {v.model || v.category}</p>
      <p className="v-small v-muted">{current ? `${stageOf(current) === 'On Trip' ? 'On duty' : 'Assigned'} · ${current.bookingId}` : 'Available for new duties'}</p>
      <form onSubmit={submit}>
        <Field label="Vehicle location"><input type="text" maxLength={120} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Theni bus stand" /></Field>
        <Field label="Available from / unavailable until"><DateTime12 value={from} onChange={setFrom} label="Available from" /></Field>
        <p className="v-small v-muted">Available for new duties from this time.</p>
        <ErrorLine message={error} />
        <Btn submit full busy={busy}>Update availability</Btn>
      </form>
    </Dialog>
  );
};

// ── Add vehicle / Add driver ────────────────────────────────────────────────

const DOC_SLOTS: { key: 'photo' | 'rc' | 'insurance' | 'fitness' | 'permit'; label: string; cat: UploadCategory; expiry?: 'insuranceExpiry' | 'fitnessExpiry' | 'permitExpiry'; required: boolean }[] = [
  { key: 'photo', label: 'Car front photo', cat: 'vehicle_photos', required: true },
  { key: 'rc', label: 'RC', cat: 'vehicle_rc', required: true },
  { key: 'insurance', label: 'Insurance', cat: 'vehicle_insurance', expiry: 'insuranceExpiry', required: true },
  { key: 'fitness', label: 'Fitness certificate (FC)', cat: 'vehicle_fc', expiry: 'fitnessExpiry', required: false },
  { key: 'permit', label: 'Permit', cat: 'vehicle_permit', expiry: 'permitExpiry', required: true },
];
const URL_FIELD = { photo: 'photoUrl', rc: 'rcDocUrl', insurance: 'insuranceDocUrl', fitness: 'fitnessDocUrl', permit: 'statePermitDocUrl' } as const;

export const AddEntity: React.FC<{ what: 'car' | 'driver' }> = ({ what }) => {
  const ws = useWorkspace();
  const p = usePartner();
  const [lookup, setLookup] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [found, setFound] = useState<null | { car?: VehicleLookup; driver?: DriverLookup; key: string }>(null);
  const [linkExisting, setLinkExisting] = useState(false);
  const car = what === 'car';

  const find = async (e: React.FormEvent) => {
    e.preventDefault();
    const digits = lookup.replace(/\D/g, '');
    const key = car ? lookup.toUpperCase().replace(/[^A-Z0-9]/g, '')
      : digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
    if (car ? !isPlate(key) : !/^[6-9]\d{9}$/.test(key)) { setError(car ? 'Enter the vehicle registration number.' : 'Enter the driver’s valid 10-digit mobile number.'); return; }
    setBusy(true); setError(''); setFound(null);
    try {
      setFound(car ? { car: await findVehicle(key), key } : { driver: await findDriver(key), key });
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };

  if (car && !linkExisting) return (
    <>
      <PageHeading title="Add vehicle" subtitle="Enter vehicle details and upload documents for NESAM review."
        action={<Btn style="secondary" icon="arrow-left" onClick={() => ws.go('Fleet', 'Vehicles')}>Back to fleet</Btn>} />
      <div className="w-narrow">
        <Btn style="text" onClick={() => { setError(''); setFound(null); setLinkExisting(true); }}>Link an existing NESAM vehicle</Btn>
        <NewVehicle plateKey="" />
      </div>
    </>
  );

  return (
    <>
      <PageHeading title={car ? 'Link an existing NESAM vehicle' : 'Add driver'} subtitle={car ? 'Check NESAM records to request a fleet transfer.' : 'Search an existing ID before creating a new one.'}
        action={<Btn style="secondary" icon="arrow-left" onClick={() => ws.go('Fleet', car ? 'Vehicles' : 'Drivers')}>Back to fleet</Btn>} />
      <div className="w-narrow">
        {car ? <Btn style="text" disabled={busy} onClick={() => { setFound(null); setError(''); setLinkExisting(false); }}>Register a new vehicle manually</Btn> : null}
        <section className="v-panel">
          <form onSubmit={find}>
            <Field label={car ? 'Vehicle registration number' : 'Driver mobile number'}>
              <input name="lookup" type="search" required minLength={3} disabled={busy} value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder={car ? 'e.g. TN60AB1234' : 'e.g. 9876543210'} autoComplete="off" inputMode={car ? 'text' : 'numeric'} />
            </Field>
            <ErrorLine message={error} />
            <button type="submit" className="v-button v-primary v-full q-button" disabled={busy}><Icon name="search" />{busy ? 'Searching…' : car ? 'Check NESAM record' : 'Find driver'}</button>
          </form>
        </section>
        {found?.car ? (found.car.found ? <FoundVehicle r={found.car} plateKey={found.key} /> : <NewVehicle key={found.key} plateKey={found.key} />) : null}
        {found?.driver ? (found.driver.found ? <FoundDriver r={found.driver} phone={found.key} /> : <NewDriver phone={found.key} vehicles={p.vehicles} />) : null}
      </div>
    </>
  );
};

const FoundVehicle: React.FC<{ r: VehicleLookup; plateKey: string }> = ({ r, plateKey }) => {
  const p = usePartner();
  const ws = useWorkspace();
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (r.mine) return <Notice title="Already in your fleet" kind="green" icon="circle-check">{plate(plateKey)} is linked to {p.profile.companyName}.</Notice>;
  const link = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const res = await requestVehicleLink(plateKey);
      ws.open({ kind: 'linking' });
      ws.say(res.status === 'Office review' ? 'Request sent to the NESAM office for review.' : `Verification code sent to ${r.otpReceiver?.name ?? 'the last-trip driver'}. Enter it under Linking requests.`);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="v-panel v-mt">
      <div className="v-between"><span className="v-eyebrow">{r.vehicleId ? carCode(r.vehicleId) : 'Car ID'}</span><Badge kind="green">Existing ID</Badge></div>
      <h2 className="v-mt">{plate(r.plate || plateKey)}</h2>
      <KV mt rows={[['Model', r.model || '—'], ['Category', r.category || '—'], ['Currently with', r.owner || 'Not attached'], ['Document status', r.verified ? 'Verified' : 'Pending verification'],
        ...(r.otpReceiver ? [['Code goes to', `${r.otpReceiver.name} · ${r.otpReceiver.phoneMask}`] as [string, string]] : [])]} />
      {r.onHold ? <Notice title="On hold" kind="amber" icon="triangle-alert">This vehicle has an open duty or hold; the office reviews the transfer.</Notice> : null}
      {r.pendingLinkId ? <Notice title="A linking request is already open" icon="clock-3">Continue it under Linking requests.</Notice> : (
        <form onSubmit={link}>
          <Check checked={ok} onChange={setOk}>I am authorized to link this vehicle to {p.profile.companyName}. Verification preserves the same ID and previous records.</Check>
          <ErrorLine message={error} />
          <button type="submit" className="v-button v-primary v-full q-button" disabled={!ok || busy}><Icon name="shield-check" />{busy ? 'Sending…' : 'Link vehicle'}</button>
        </form>
      )}
    </section>
  );
};

const FoundDriver: React.FC<{ r: DriverLookup; phone: string }> = ({ r, phone }) => {
  const p = usePartner();
  const ws = useWorkspace();
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (r.mine) return <Notice title="Already in your fleet" kind="green" icon="circle-check">{r.name} is linked to {p.profile.companyName}.</Notice>;
  const link = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const res = await requestDriverLink(phone);
      ws.open({ kind: 'linking' });
      ws.say(res.status === 'Office review' ? 'Request sent to the NESAM office for review.' : `Verification code sent to ${r.name ?? 'the driver'}. Enter it under Linking requests.`);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="v-panel v-mt">
      <div className="v-between"><span className="v-eyebrow">{r.driverId ? driverCode(r.driverId) : 'Driver ID'}</span><Badge kind="green">Existing ID</Badge></div>
      <h2 className="v-mt">{r.name || 'Driver'}</h2>
      <KV mt rows={[['Registered mobile', r.phoneMask || '—'], ['Account role', r.kind === 'owner_driver' ? 'Owner Driver' : 'Vendor Driver'], ['Current fleet', r.fleet || 'Not attached'], ['Document status', r.approved ? 'Verified' : 'Pending verification']]} />
      {r.pendingLinkId ? <Notice title="A linking request is already open" icon="clock-3">Continue it under Linking requests.</Notice> : (
        <form onSubmit={link}>
          <Check checked={ok} onChange={setOk}>I am authorized to link this driver to {p.profile.companyName}. Verification preserves the same ID and previous records.</Check>
          <ErrorLine message={error} />
          <button type="submit" className="v-button v-primary v-full q-button" disabled={!ok || busy}><Icon name="shield-check" />{busy ? 'Sending…' : 'Link driver'}</button>
        </form>
      )}
    </section>
  );
};

const NewVehicle: React.FC<{ plateKey: string }> = ({ plateKey }) => {
  const p = usePartner();
  const ws = useWorkspace();
  const [number, setNumber] = useState(plateKey);
  const [categoryId, setCategoryId] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [seats, setSeats] = useState('');
  const [files, setFiles] = useState<Partial<Record<(typeof DOC_SLOTS)[number]['key'], File>>>({});
  const [expiries, setExpiries] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const category = p.categories.find((c) => c.id === categoryId);
  const added = DOC_SLOTS.filter((s) => files[s.key]).length;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const n = Number(seats || category?.seatingCapacity || 0);
    if (!isPlate(number)) { setError('Enter the registration number as on the RC (e.g. TN60AB1234).'); return; }
    if (p.vehicles.some((v) => normalizePlate(v.vehicleNumber) === normalizePlate(number))) { setError('This vehicle is already in your fleet.'); return; }
    if (!category) { setError('Choose the vehicle category.'); return; }
    if (!make.trim() || !model.trim()) { setError('Enter the make and model as on the RC.'); return; }
    if (!Number.isInteger(n) || n < 1 || n > 20) { setError('Enter the passenger capacity (driver excluded).'); return; }
    const missing = DOC_SLOTS.filter((s) => s.required && !files[s.key]).map((s) => s.label);
    if (missing.length) { setError(`Add: ${missing.join(', ')}.`); return; }
    const missingDates = DOC_SLOTS.filter((s) => s.expiry && files[s.key] && !expiries[s.expiry]).map((s) => s.label);
    if (missingDates.length) { setError(`Enter the expiry date for: ${missingDates.join(', ')}.`); return; }
    setBusy(true);
    try {
      const urls: Record<string, string> = {};
      for (const slot of DOC_SLOTS) {
        const f = files[slot.key];
        if (!f) continue;
        setProgress(`Uploading ${slot.label}…`);
        const stored = await uploadVendorFile(slot.cat, f, () => undefined).promise;
        urls[URL_FIELD[slot.key]] = await getDownloadURL(ref(storage, stored.path));
      }
      setProgress('Saving…');
      await p.actions.addVehicle({
        vehicleNumber: number, categoryId: category.id, category: category.name, make: make.trim(), model: model.trim(), year: year.trim(), seatingCapacity: n,
        ...urls, insuranceExpiry: expiries.insuranceExpiry, fitnessExpiry: expiries.fitnessExpiry, permitExpiry: expiries.permitExpiry,
      });
      ws.go('Fleet', 'Vehicles');
      ws.say(`${plate(number)} added. NESAM verifies the documents before it can take duties.`);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); setProgress(''); }
  };

  return (
    <>
      <Notice title="Manual vehicle registration" icon="circle-plus">Enter the details on your RC. NESAM reviews the documents before approving the vehicle.</Notice>
      <section className="v-panel v-mt m-new-vehicle n-onboarding">
        <h2>Register new vehicle</h2>
        <p className="m-form-intro">Enter the details on your RC and add the verification files.</p>
        <form onSubmit={submit} noValidate>
          <Field label="Registration number *" className="v-field n-field"><input type="text" maxLength={12} autoComplete="off" value={number} onChange={(e) => setNumber(e.target.value.toUpperCase())} /></Field>
          <div className="m-vehicle-fields">
            <Field label="Category *" className="v-field n-field">
              <select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); const c = p.categories.find((x) => x.id === e.target.value); if (c?.seatingCapacity && !seats) setSeats(String(c.seatingCapacity)); }}>
                <option value="">Select a category</option>
                {p.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Make *" className="v-field n-field"><input type="text" maxLength={40} value={make} onChange={(e) => setMake(e.target.value)} placeholder="e.g. Maruti Suzuki" /></Field>
            <Field label="Model *" className="v-field n-field"><input type="text" maxLength={40} value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. Dzire" /></Field>
            <Field label="Passenger capacity *" className="v-field n-field"><input type="number" min={1} max={20} value={seats} onChange={(e) => setSeats(e.target.value)} /><small>Driver excluded · as per RC</small></Field>
            <Field label="Year" className="v-field n-field"><input type="text" inputMode="numeric" maxLength={4} value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, ''))} /></Field>
          </div>
          <section className="m-vehicle-preview" aria-label="Vehicle model preview">
            <span className="m-preview-label">Vehicle preview</span>
            <div id="m-preview" aria-live="polite">
              {make || model ? (
                <div className="v-car-heading"><div><h2>{plate(number)}</h2><p>{[make, model].filter(Boolean).join(' ')}</p><p className="m-fleet-capacity">{category?.name ?? 'Category'} · {seats || '—'} passengers</p></div><img src={carImage({ make, model, category: category?.name ?? '' })} alt="" /></div>
              ) : <div className="m-preview-empty"><Icon name="car-front" /><span>Enter make and model<small>Your vehicle category and passenger details appear here.</small></span></div>}
            </div>
          </section>
          <div className="n-upload-count" role="status"><strong>{added} of {DOC_SLOTS.length} uploads added</strong><span>JPG, PNG, WEBP or PDF, up to 10 MB each.</span></div>
          {DOC_SLOTS.map((slot) => (
            <div key={slot.key} className="n-upload-field n-document-upload" role="group" aria-label={slot.label}>
              <div className="n-upload-label">{slot.label}{slot.required ? <i aria-hidden="true"> *</i> : null}</div>
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setFiles((f) => ({ ...f, [slot.key]: e.target.files?.[0] }))} />
              {slot.expiry ? <Field label={`${slot.label} valid until`}><input type="date" value={expiries[slot.expiry] ?? ''} onChange={(e) => setExpiries((x) => ({ ...x, [slot.expiry!]: e.target.value }))} /></Field> : null}
            </div>
          ))}
          <ErrorLine message={error} />
          {progress ? <p className="v-small v-muted" role="status">{progress}</p> : null}
          <Btn submit full icon="shield-check" busy={busy}>Submit for verification</Btn>
        </form>
      </section>
    </>
  );
};

const NewDriver: React.FC<{ phone: string; vehicles: FleetVehicle[] }> = ({ phone, vehicles }) => {
  const p = usePartner();
  const ws = useWorkspace();
  const [vehicle, setVehicle] = useState('');
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const digits = phone.replace(/\D/g, '');
    if (!/^[6-9]\d{9}$/.test(digits)) { setError('Enter a valid 10-digit mobile number.'); return; }
    setBusy(true); setError('');
    try {
      await p.actions.inviteDriver(digits, vehicle);
      ws.go('Fleet', 'Drivers');
      ws.say(`Invitation saved for ${maskPhone(digits)}. The driver completes the selfie and licence checks in the NESAM Driver app.`);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <>
      <Notice title="No existing ID found" icon="circle-plus">Invite the driver to create a new Driver ID. Documents need office verification.</Notice>
      <section className="v-panel v-mt n-onboarding">
        <h2>Add driver</h2>
        <p className="m-form-intro">The driver signs in to the NESAM Driver app with this mobile number, takes a live selfie and uploads the driving licence. They join your fleet once NESAM verifies them.</p>
        <form onSubmit={submit}>
          <Field label="Checked mobile number" className="v-field n-field"><input type="tel" readOnly value={phone} /><small>To use another number, check it again from Add driver.</small></Field>
          <Field label="Usual vehicle (optional)" className="v-field n-field">
            <select value={vehicle} onChange={(e) => setVehicle(e.target.value)}>
              <option value="">Choose later</option>
              {vehicles.map((v) => <option key={v.id} value={v.vehicleNumber}>{plate(v.vehicleNumber)} · {v.model || v.category}</option>)}
            </select>
          </Field>
          <Check checked={ok} onChange={setOk}>I am authorized to add this driver to {p.profile.companyName}.</Check>
          <ErrorLine message={error} />
          <Btn submit full icon="user-round-plus" busy={busy} disabled={!ok}>Send invitation</Btn>
        </form>
      </section>
    </>
  );
};

// ── Linking requests ────────────────────────────────────────────────────────

const LINK_BADGE: Record<string, ['neutral' | 'green' | 'amber' | 'red', string]> = {
  'Awaiting OTP': ['neutral', 'Waiting for code'], 'Office review': ['amber', 'Office review'], Completed: ['green', 'Linked'], Rejected: ['red', 'Declined'], Cancelled: ['neutral', 'Cancelled'],
};

export const LinkingScreen: React.FC = () => {
  const p = usePartner();
  const ws = useWorkspace();
  const mine = p.links.filter((l) => l.toVendorId === p.profile.id);
  const leaving = p.links.filter((l) => l.fromVendorId === p.profile.id && l.toVendorId !== p.profile.id);
  return (
    <>
      <PageHeading title="Linking requests" subtitle="Permanent IDs and attachment changes." action={<Btn style="secondary" icon="arrow-left" onClick={() => ws.go('Fleet')}>Back to fleet</Btn>} />
      {mine.length || leaving.length ? (
        <div className="v-card-grid">
          {mine.map((l) => <LinkCard key={l.id} link={l} incoming />)}
          {leaving.map((l) => <LinkCard key={l.id} link={l} incoming={false} />)}
        </div>
      ) : <Empty title="No linking requests">ID verification and transfer updates appear here.</Empty>}
    </>
  );
};

const LinkCard: React.FC<{ link: PartnerLink; incoming: boolean }> = ({ link: l, incoming }) => {
  const ws = useWorkspace();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [kind, label] = LINK_BADGE[l.status] ?? ['neutral', l.status];
  const run = async (what: string, work: () => Promise<string>) => {
    setBusy(what); setError('');
    try { ws.say(await work()); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };
  return (
    <article className="v-panel">
      <div className="v-between"><span className="v-eyebrow">{l.id.slice(0, 12).toUpperCase()}</span><Badge kind={kind}>{label}</Badge></div>
      <h2 className="v-mt">{l.kind === 'vehicle' ? plate(l.subjectLabel) : l.subjectLabel}</h2>
      <p className="v-small v-muted v-mt">{l.kind === 'vehicle' ? carCode(l.subjectId) : driverCode(l.subjectId)} · {l.kind === 'vehicle' ? 'Vehicle' : 'Driver'}</p>
      <p className="v-small v-muted v-mt">
        {incoming ? `From ${l.fromVendorName || (l.fromType === 'owner_driver' ? 'Owner-driver' : 'not attached')}` : `Moving to ${l.toVendorName}`} · {dayTime(l.createdAt)}
      </p>
      {l.status === 'Office review' ? <p className="v-small v-muted v-mt">{l.blockedReason || 'Previous attachment is under office review. Current confirmed duties continue.'}</p> : null}
      {l.status === 'Rejected' && l.rejectedReason ? <p className="v-small v-muted v-mt">{l.rejectedReason}</p> : null}
      {incoming && l.status === 'Awaiting OTP' ? (
        <form className="v-mt" onSubmit={(e) => { e.preventDefault(); if (code.length === 6) run('verify', async () => { const r = await verifyLinkCode(l.id, code); setCode(''); return r.message; }); }}>
          <Field label={`6-digit code sent to ${l.kind === 'driver' ? 'the driver' : l.receiverName || 'the last-trip driver'}${l.receiverPhoneMask ? ` (${l.receiverPhoneMask})` : ''}`}>
            <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <ErrorLine message={error} />
          <div className="v-action-row">
            <Btn submit icon="shield-check" busy={busy === 'verify'} disabled={code.length !== 6}>Verify</Btn>
            <Btn style="secondary" icon="refresh-cw" busy={busy === 'resend'} onClick={() => run('resend', async () => { const r = await resendLinkCode(l.id); return r.delivered ? 'A new code was sent.' : r.error || 'The code could not be sent. Ask the office for help.'; })}>Resend code</Btn>
            <Btn style="text" icon="chevron-right" busy={busy === 'help'} onClick={() => run('help', async () => { await askOfficeForHelp(l.id); return 'The NESAM office will complete this request.'; })}>Ask the office</Btn>
            <Btn style="text" icon="x" busy={busy === 'cancel'} onClick={() => run('cancel', async () => { await cancelLink(l.id); return 'Request cancelled.'; })}>Cancel</Btn>
          </div>
        </form>
      ) : <ErrorLine message={error} />}
    </article>
  );
};

// ── Documents & verification ────────────────────────────────────────────────

export const DocumentsScreen: React.FC = () => {
  const p = usePartner();
  const ws = useWorkspace();
  const [open, setOpen] = useState<null | { kind: 'car' | 'driver'; id: string }>(null);
  const order = (s: DocState) => ({ Expired: 0, Rejected: 1, Expiring: 2, Pending: 3, Verified: 4 })[s];
  const rows = [
    ...p.drivers.map((d) => ({ kind: 'driver' as const, id: d.id, name: d.name || maskPhone(d.phone), code: driverCode(d.id, d.code), what: 'Driving licence', date: d.licenseExpiry, state: driverDocState(d) })),
    ...p.vehicles.map((v) => ({ kind: 'car' as const, id: v.id, name: plate(v.vehicleNumber), code: carCode(v.id, v.code), what: 'Vehicle documents', date: vehicleValidUntil(v), state: vehicleDocState(v) })),
  ].sort((a, b) => order(a.state) - order(b.state));
  return (
    <>
      <PageHeading title="Documents & verification" subtitle="A hold applies only to the affected Driver ID or Car ID." action={<Btn style="secondary" icon="arrow-left" onClick={() => ws.go('Fleet')}>Back to fleet</Btn>} />
      {rows.length ? (
        <div className="v-list">
          {rows.map((r) => (
            <article key={`${r.kind}-${r.id}`} className="v-document-card">
              <Icon name="file-check" />
              <div><h2>{r.name}</h2><p>{r.code} · {r.what}</p><small>{r.date ? shortDate(r.date) : 'Date pending'}</small></div>
              <Badge kind={docKind(r.state)}>{verifyLabel(r.state)}</Badge>
              <Btn style="text" icon="chevron-right" onClick={() => setOpen({ kind: r.kind, id: r.id })}>View / renew</Btn>
            </article>
          ))}
        </div>
      ) : <Empty title="No documents yet">Add vehicles and drivers to see their document status here.</Empty>}
      {open ? <DocumentsSheet kind={open.kind} id={open.id} onClose={() => setOpen(null)} /> : null}
    </>
  );
};
