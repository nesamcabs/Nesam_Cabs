import React, { useEffect, useMemo, useState } from 'react';
import type { FleetDriver, FleetVehicle } from '../types';
import { usePartner } from '../state/Partner';
import { findVehicle, requestVehicleLink, type LinkRequestResult, type VehicleLookup } from '../services/partnerLinks';
import { Badge, Banner, Button, Dialog, Empty, KV, SelectInput, TextInput, Toast, useToast, Avatar } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { displayPlate, isPlate, normalizePlate } from '../utils/fleet';
import { CodePanel } from './LinkParts';
import { AddDriverDialog } from './DriversPage';

type FleetTab = 'Cars' | 'Drivers' | 'Documents' | 'Availability';

const docTone = { Approved: 'green', Pending: 'amber', 'Needs Correction': 'amber', Rejected: 'red' } as const;
const docText = { Approved: 'Verified', Pending: 'Awaiting verification', 'Needs Correction': 'Needs correction', Rejected: 'Rejected' } as const;
const currentYear = new Date().getFullYear();

export const VehiclesPage: React.FC = () => {
  const { vehicles, drivers, intent, clearIntent, go, actions } = usePartner();
  const [tab, setTab] = useState<FleetTab>('Cars');
  const [addingVehicle, setAddingVehicle] = useState(false);
  const [addingDriver, setAddingDriver] = useState(false);
  const [busyId, setBusyId] = useState('');
  const { toast, show, dismiss } = useToast();

  useEffect(() => {
    if (intent === 'add') {
      setAddingVehicle(true);
      clearIntent();
    }
  }, [intent, clearIntent]);

  const assignable = useMemo(() => drivers.filter((d) => d.accountStatus === 'Approved' && !d.suspended), [drivers]);

  const act = async (id: string, work: () => Promise<void>, ok: string) => {
    if (busyId) return;
    setBusyId(id);
    try {
      await work();
      show(ok);
    } catch (e) {
      show(e instanceof Error ? e.message : 'The change was not saved.', 'err');
    } finally {
      setBusyId('');
    }
  };

  const toggleDriver = async (d: FleetDriver) => {
    if (busyId) return;
    setBusyId(d.id);
    try {
      await actions.setSuspended(d.id, !d.suspended);
      show(d.suspended ? `${d.name || 'Driver'} resumed for duty.` : `${d.name || 'Driver'} placed on hold.`);
    } catch (e) {
      show(e instanceof Error ? e.message : 'The change was not saved.', 'err');
    } finally {
      setBusyId('');
    }
  };

  // Consolidated documents for both vehicles and drivers
  const documentsList = useMemo(() => {
    const list: Array<{
      id: string;
      kind: 'car' | 'driver';
      title: string;
      subtitle: string;
      docName: string;
      status: string;
      tone: 'green' | 'amber' | 'red';
      expires: string;
    }> = [];

    vehicles.forEach((v) => {
      list.push({
        id: v.id,
        kind: 'car',
        title: v.vehicleNumber,
        subtitle: [v.make, v.model, v.category].filter(Boolean).join(' · '),
        docName: 'RC, Insurance, FC, Permit, PUC',
        status: docText[v.docStatus] || 'Pending',
        tone: docTone[v.docStatus] || 'amber',
        expires: v.status === 'Active' ? 'Valid & Verified' : 'Office verification pending',
      });
    });

    drivers.forEach((d) => {
      list.push({
        id: d.id,
        kind: 'driver',
        title: d.name || 'Driver',
        subtitle: `+91 ${d.phone || '—'}`,
        docName: 'Driving Licence & Badge',
        status: d.accountStatus === 'Approved' ? 'Verified' : 'Verification pending',
        tone: d.accountStatus === 'Approved' ? 'green' : 'amber',
        expires: d.licenseExpiry ? `Valid till ${d.licenseExpiry}` : 'Active on platform',
      });
    });

    return list;
  }, [vehicles, drivers]);

  return (
    <div>
      <Toast toast={toast} onDismiss={dismiss} />

      {/* Header bar matching reference vTitle */}
      <div className="v-between" style={{ marginBottom: 18, alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: 'var(--v-ink)', letterSpacing: '-0.3px' }}>Fleet</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--v-muted)' }}>Your cars, drivers and availability.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Button variant="secondary" icon="userplus" onClick={() => setAddingDriver(true)}>
            Add driver
          </Button>
          <Button variant="primary" icon="plus" onClick={() => setAddingVehicle(true)}>
            Add vehicle
          </Button>
        </div>
      </div>

      {/* Tabs matching reference: Cars, Drivers, Documents, Availability */}
      <div className="v-tabs" role="group" aria-label="Fleet tabs" style={{ marginBottom: 16 }}>
        <button type="button" aria-pressed={tab === 'Cars'} onClick={() => setTab('Cars')}>
          <span>Cars</span>
          <small>{vehicles.length}</small>
        </button>
        <button type="button" aria-pressed={tab === 'Drivers'} onClick={() => setTab('Drivers')}>
          <span>Drivers</span>
          <small>{drivers.length}</small>
        </button>
        <button type="button" aria-pressed={tab === 'Documents'} onClick={() => setTab('Documents')}>
          <span>Documents</span>
          <small>{documentsList.length}</small>
        </button>
        <button type="button" aria-pressed={tab === 'Availability'} onClick={() => setTab('Availability')}>
          <span>Availability</span>
          <small>{vehicles.filter((v) => v.status === 'Active').length}</small>
        </button>
      </div>

      {/* Linking shortcut matching reference .v-linking-shortcut */}
      <div className="v-linking-shortcut" style={{ marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => go('requests')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            borderRadius: 12,
            border: '1px solid var(--v-line)',
            background: '#fff',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--v-ink)',
            width: '100%',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="swap" /> Linking requests & transfers
          </span>
          <Icon name="arrow" />
        </button>
      </div>

      {/* Cars Tab */}
      {tab === 'Cars' && (
        vehicles.length === 0 ? (
          <div className="vx-card">
            <Empty
              icon="car"
              title="No vehicles in your fleet yet"
              action={
                <Button variant="primary" icon="plus" onClick={() => setAddingVehicle(true)}>
                  Add your first vehicle
                </Button>
              }
            >
              Enter the registration number. If the vehicle is already on NESAM you can link it; otherwise submit its documents for verification.
            </Empty>
          </div>
        ) : (
          <div className="v-card-grid">
            {vehicles.map((v) => (
              <VehicleCardItem
                key={v.id}
                v={v}
                busy={busyId === v.id}
                driverOptions={assignable.map((d) => ({ value: d.id, label: `${d.name || 'Driver'} · +91 ${d.phone}` }))}
                onPair={(driverId) => act(v.id, () => actions.pairDriver(v.id, driverId), driverId ? 'Driver paired with vehicle.' : 'Driver unpaired.')}
                onStatus={(s) => act(v.id, () => actions.setVehicleStatus(v.id, s), `${v.vehicleNumber} status updated.`)}
              />
            ))}
          </div>
        )
      )}

      {/* Drivers Tab */}
      {tab === 'Drivers' && (
        drivers.length === 0 ? (
          <div className="vx-card">
            <Empty
              icon="users"
              title="No drivers in your fleet yet"
              action={
                <Button variant="primary" icon="userplus" onClick={() => setAddingDriver(true)}>
                  Add your first driver
                </Button>
              }
            >
              Add drivers using their mobile numbers. If they drive on NESAM you can link them; otherwise an invitation is sent.
            </Empty>
          </div>
        ) : (
          <div className="v-card-grid">
            {drivers.map((d) => (
              <DriverCardItem
                key={d.id}
                driver={d}
                busy={busyId === d.id}
                onToggle={() => toggleDriver(d)}
              />
            ))}
          </div>
        )
      )}

      {/* Documents Tab */}
      {tab === 'Documents' && (
        <div style={{ display: 'grid', gap: 14 }}>
          <Banner tone="info">
            Keep your fleet compliant. Renewed documents are submitted for office approval to ensure uninterrupted dispatch.
          </Banner>
          <div className="v-card-grid">
            {documentsList.map((doc) => (
              <article key={`${doc.kind}-${doc.id}`} className="v-panel" style={{ padding: 18 }}>
                <div className="v-between">
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--v-muted)', textTransform: 'uppercase' }}>
                    {doc.kind === 'car' ? 'Vehicle' : 'Driver'}
                  </span>
                  <Badge tone={doc.tone}>{doc.status}</Badge>
                </div>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: '8px 0 4px', color: 'var(--v-ink)' }}>
                  {doc.title}
                </h3>
                <p style={{ fontSize: 12, color: 'var(--v-muted)', margin: 0 }}>
                  {doc.subtitle}
                </p>
                <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--v-page)', borderRadius: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--v-ink)' }}>{doc.docName}</div>
                  <div style={{ fontSize: 11, color: 'var(--v-muted)', marginTop: 2 }}>{doc.expires}</div>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {/* Availability Tab */}
      {tab === 'Availability' && (
        <div className="v-card-grid">
          {vehicles.map((v) => (
            <article key={v.id} className="v-panel" style={{ padding: 18 }}>
              <div className="v-between">
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--v-ink)' }}>
                  {v.vehicleNumber}
                </h3>
                <Badge tone={v.status === 'Active' ? 'green' : 'amber'}>
                  {v.status === 'Active' ? 'Ready for Duty' : v.status}
                </Badge>
              </div>
              <p style={{ fontSize: 12, color: 'var(--v-muted)', margin: '6px 0 14px' }}>
                {[v.make, v.model, v.category].filter(Boolean).join(' · ')}
              </p>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, borderTop: '1px solid var(--v-line)' }}>
                <span style={{ fontSize: 13, color: 'var(--v-muted)' }}>
                  Assigned driver: <strong>{v.assignedDriverName || 'None'}</strong>
                </span>
                <Button
                  size="sm"
                  variant={v.status === 'Active' ? 'secondary' : 'primary'}
                  onClick={() => act(v.id, () => actions.setVehicleStatus(v.id, v.status === 'Active' ? 'Maintenance' : 'Active'), 'Availability updated.')}
                >
                  {v.status === 'Active' ? 'Set Off Duty' : 'Set Available'}
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Add Vehicle Modal */}
      <AddVehicleDialog open={addingVehicle} onClose={() => setAddingVehicle(false)} onToast={show} />

      {/* Add Driver Modal */}
      <AddDriverDialog
        open={addingDriver}
        onClose={() => setAddingDriver(false)}
        vehicleOptions={vehicles.map((v) => v.vehicleNumber)}
        onToast={show}
        onInvite={async (phone, plate) => {
          await actions.inviteDriver(phone, plate);
          show(`Invitation sent to +91 ${phone}`);
        }}
      />
    </div>
  );
};

const VehicleCardItem: React.FC<{
  v: FleetVehicle;
  busy: boolean;
  driverOptions: { value: string; label: string }[];
  onPair: (driverId: string) => void;
  onStatus: (s: FleetVehicle['status']) => void;
}> = ({ v, busy, driverOptions, onPair, onStatus }) => {
  const held = v.status === 'Accident Hold';

  return (
    <article className="v-panel v-vehicle-card" style={{ padding: 18 }}>
      <div className="v-between">
        <span className="v-eyebrow" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.8px', color: 'var(--v-muted)' }}>
          {v.vehicleNumber}
        </span>
        <Badge tone={docTone[v.docStatus]}>{docText[v.docStatus]}</Badge>
      </div>

      <div className="v-car-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '10px 0' }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: 'var(--v-ink)', letterSpacing: '-0.2px' }}>
            {v.vehicleNumber}
          </h2>
          <p style={{ margin: '3px 0 0', fontSize: 13, color: 'var(--v-muted)' }}>
            {[v.make, v.model, v.category].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>

      <p className="v-availability-line" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--v-ink)', margin: '8px 0 4px' }}>
        <Icon name="clock" />
        <span>{v.status === 'Active' ? 'Available · Ready for dispatch' : v.status}</span>
      </p>

      <p className="v-document-date" style={{ fontSize: 11, color: 'var(--v-muted)', margin: 0 }}>
        Verification status: {docText[v.docStatus]}
      </p>

      {v.docStatus === 'Rejected' && v.rejectionReason && (
        <div style={{ marginTop: 10 }}>
          <Banner tone="err">{v.rejectionReason}</Banner>
        </div>
      )}

      {held && (
        <div style={{ marginTop: 10 }}>
          <Banner tone="warn">This vehicle is on hold by NESAM and cannot be dispatched.</Banner>
        </div>
      )}

      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--v-line)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <SelectInput
          id={`pair-${v.id}`}
          label="Assigned driver"
          value={v.assignedDriverId}
          onChange={onPair}
          placeholder="No driver paired"
          options={driverOptions}
        />
        <SelectInput
          id={`st-${v.id}`}
          label="Fleet status"
          value={held ? 'Accident Hold' : v.status}
          onChange={(s) => onStatus(s as FleetVehicle['status'])}
          options={
            held
              ? [{ value: 'Accident Hold', label: 'On hold (NESAM)' }]
              : [
                  { value: 'Active', label: 'In service' },
                  { value: 'Maintenance', label: 'Maintenance' },
                  { value: 'Inactive', label: 'Inactive' },
                ]
          }
        />
      </div>

      {busy && <p className="vx-hint">Saving changes…</p>}
    </article>
  );
};

const DriverCardItem: React.FC<{
  driver: FleetDriver;
  busy: boolean;
  onToggle: () => void;
}> = ({ driver, busy, onToggle }) => {
  return (
    <article className="v-panel v-person-card" style={{ padding: 18 }}>
      <div className="v-between">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span className="v-avatar" style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--v-line)', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 15, color: 'var(--v-ink)' }}>
            {(driver.name || 'DR').slice(0, 2).toUpperCase()}
          </span>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--v-ink)' }}>
              {driver.name || 'Driver'}
            </h2>
            <p style={{ fontSize: 12, color: 'var(--v-muted)', margin: '2px 0 0' }}>
              +91 {driver.phone || '—'}
            </p>
          </div>
        </div>
        <Badge tone={driver.accountStatus === 'Approved' ? (driver.online ? 'green' : 'gray') : 'amber'}>
          {driver.accountStatus === 'Approved' ? (driver.online ? 'Online' : 'Offline') : 'Pending Review'}
        </Badge>
      </div>

      <div style={{ marginTop: 14, padding: '10px 12px', background: 'var(--v-page)', borderRadius: 10, display: 'grid', gap: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
          <span style={{ color: 'var(--v-muted)' }}>Assigned vehicle</span>
          <strong style={{ color: 'var(--v-ink)' }}>{driver.assignedVehicleNumber || 'None'}</strong>
        </div>
        {driver.licenseExpiry && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ color: 'var(--v-muted)' }}>Licence valid till</span>
            <strong style={{ color: 'var(--v-ink)' }}>{driver.licenseExpiry}</strong>
          </div>
        )}
      </div>

      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        {driver.phone && (
          <a
            className="v-button v-secondary"
            href={`tel:${driver.phone}`}
            style={{ textDecoration: 'none', padding: '6px 12px', fontSize: 12 }}
          >
            <Icon name="phone" /> Call
          </a>
        )}
        <Button
          size="sm"
          variant={driver.suspended ? 'primary' : 'danger'}
          loading={busy}
          onClick={onToggle}
        >
          {driver.suspended ? 'Resume driver' : 'Hold driver'}
        </Button>
      </div>
    </article>
  );
};

type Step = 'plate' | 'new' | 'found' | 'code' | 'added';

const AddVehicleDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  onToast: (t: string, k?: 'ok' | 'err') => void;
}> = ({ open, onClose, onToast }) => {
  const { categories, links, go, actions } = usePartner();
  const [step, setStep] = useState<Step>('plate');
  const [plate, setPlate] = useState('');
  const [found, setFound] = useState<VehicleLookup | null>(null);
  const [result, setResult] = useState<LinkRequestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ categoryId: '', make: '', model: '', year: '', seats: '' });

  useEffect(() => {
    if (open) {
      setStep('plate');
      setPlate('');
      setFound(null);
      setResult(null);
      setError('');
      setBusy(false);
      setForm({ categoryId: '', make: '', model: '', year: '', seats: '' });
    }
  }, [open]);

  const link = result ? links.find((l) => l.id === result.linkId) : undefined;

  const check = async () => {
    if (!isPlate(plate)) return setError('Enter a valid Indian registration plate (e.g. TN 60 AB 1234).');
    setBusy(true);
    setError('');
    try {
      const f = await findVehicle(plate);
      setFound(f);
      if (f.found) setStep('found');
      else setStep('new');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check the registration.');
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!form.categoryId) return setError('Choose a vehicle category.');
    const cat = categories.find((c) => c.id === form.categoryId)?.name || '';
    setBusy(true);
    setError('');
    try {
      await actions.addVehicle({
        vehicleNumber: normalizePlate(plate),
        categoryId: form.categoryId,
        category: cat,
        make: form.make.trim(),
        model: form.model.trim(),
        year: form.year ? form.year : String(currentYear),
        seatingCapacity: form.seats ? Number(form.seats) : 4,
      });
      setStep('added');
      onToast(`${displayPlate(plate)} added to your fleet for document verification.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The vehicle was not added.');
    } finally {
      setBusy(false);
    }
  };

  const request = async (office: boolean) => {
    setBusy(true);
    setError('');
    try {
      const r = await requestVehicleLink(plate, office);
      setResult(r);
      setStep('code');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the link request.');
    } finally {
      setBusy(false);
    }
  };

  const f = found;
  const blocked = f && (f.mine || !f.verified || !!f.pendingLinkId);
  const title =
    step === 'plate'
      ? 'Add a vehicle'
      : step === 'new'
      ? `Register ${displayPlate(plate)}`
      : step === 'added'
      ? `${displayPlate(plate)} registered`
      : step === 'code'
      ? 'Confirm vehicle move'
      : displayPlate(plate);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      eyebrow="Fleet expansion"
      title={title}
      locked={busy}
      footer={
        step === 'plate' ? (
          <>
            <Button onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={check}>Check registration</Button>
          </>
        ) : step === 'new' ? (
          <>
            <Button onClick={() => { setStep('plate'); setError(''); }} disabled={busy}>Back</Button>
            <Button variant="primary" loading={busy} onClick={create}>Save vehicle</Button>
          </>
        ) : step === 'found' ? (
          <>
            <Button onClick={() => { setStep('plate'); setError(''); }} disabled={busy}>Back</Button>
            {f && !blocked && (
              <Button variant="primary" loading={busy} onClick={() => request(!f.otpReceiver)}>
                {f.otpReceiver ? 'Send code to driver' : 'Ask office to move'}
              </Button>
            )}
            {f?.pendingLinkId && (
              <Button variant="primary" onClick={() => { onClose(); go('requests'); }}>Open requests</Button>
            )}
          </>
        ) : (
          <Button variant="primary" onClick={onClose}>
            {step === 'code' && link && link.status === 'Completed' ? 'Done' : 'Close'}
          </Button>
        )
      }
    >
      {step === 'plate' && (
        <>
          <p className="vx-muted" style={{ marginBottom: 14 }}>
            Enter the vehicle registration number. We will check if it already operates on NESAM.
          </p>
          <TextInput
            id="add-vehicle-plate"
            label="Registration number"
            value={plate}
            onChange={(e) => { setPlate(e.target.value.toUpperCase()); setError(''); }}
            placeholder="e.g. TN 60 AB 1234"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') check(); }}
          />
          {error && <p className="vx-err" role="alert">{error}</p>}
        </>
      )}

      {step === 'new' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <Banner>
            <strong>{displayPlate(plate)}</strong> is new to NESAM. Add its basic details now; you can attach photos and documents in your fleet overview.
          </Banner>
          <SelectInput
            id="v-cat"
            label="Category"
            value={form.categoryId}
            onChange={(v) => { setForm((f) => ({ ...f, categoryId: v })); setError(''); }}
            placeholder="Select a category"
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
          />
          <div className="vx-grid vx-grid--2" style={{ gap: 10 }}>
            <TextInput id="v-make" label="Make (optional)" value={form.make} onChange={(e) => setForm((f) => ({ ...f, make: e.target.value }))} placeholder="e.g. Maruti" />
            <TextInput id="v-model" label="Model (optional)" value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} placeholder="e.g. Dzire" />
          </div>
          <div className="vx-grid vx-grid--2" style={{ gap: 10 }}>
            <TextInput id="v-year" label="Year" inputMode="numeric" value={form.year} onChange={(e) => setForm((f) => ({ ...f, year: e.target.value }))} placeholder={String(currentYear)} />
            <TextInput id="v-seats" label="Seats" inputMode="numeric" value={form.seats} onChange={(e) => setForm((f) => ({ ...f, seats: e.target.value }))} placeholder="e.g. 5" />
          </div>
          {error && <p className="vx-err" role="alert">{error}</p>}
        </div>
      )}

      {step === 'found' && f && (
        <>
          <div className="vx-found">
            <div className="vx-media">
              <Avatar name={f.plate ?? ''} icon="car" large />
              <div>
                <strong className="vx-plate">{f.plate}</strong>
                <small>{[f.model, f.category].filter(Boolean).join(' · ') || 'Already on NESAM'}</small>
              </div>
            </div>
            <div style={{ marginTop: 10 }}>
              <KV label="Currently with">{f.mine ? 'Your fleet' : f.owner || 'Another fleet'}</KV>
              <KV label="Documents">{f.verified ? <Badge tone="green">Verified</Badge> : <Badge tone="amber">Not verified</Badge>}</KV>
            </div>
          </div>
          {f.mine && <Banner>This vehicle is already in your fleet.</Banner>}
          {f.pendingLinkId && <Banner tone="warn">You already have an open request for this vehicle.</Banner>}
          {!blocked && f.onHold && <Banner tone="warn">This vehicle is on hold. Only the NESAM office can move it.</Banner>}
          {!blocked && !f.verified && <Banner tone="warn">This vehicle is not verified yet, so the NESAM office has to approve the move.</Banner>}
          {!blocked && (f.openDuties ?? 0) > 0 && <Banner tone="warn">It has {f.openDuties} booked {f.openDuties === 1 ? 'duty' : 'duties'}. Those must be reassigned before it can move.</Banner>}
          {!blocked && (f.otpReceiver
            ? <Banner>To confirm the change we send a code to <strong>{f.otpReceiver.name}</strong> ({f.otpReceiver.phoneMask}), who drove this car last. They read it to you and you enter it.</Banner>
            : <Banner tone="warn">No driver has completed a trip in this car recently. The NESAM office will verify the change with you.</Banner>)}
          {error && <p className="vx-err" role="alert">{error}</p>}
        </>
      )}

      {step === 'code' && result && (
        link ? <CodePanel link={link} testCode={result.testCode} onToast={onToast} /> : <Banner>Request sent. Loading status…</Banner>
      )}

      {step === 'added' && (
        <Banner tone="ok">
          {displayPlate(plate)} has been registered. You can pair it with an approved driver and assign it to upcoming duties.
        </Banner>
      )}
    </Dialog>
  );
};
