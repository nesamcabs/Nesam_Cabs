// Add driver, shown as a bottom sheet like the vehicle form. The mobile number is checked against NESAM's records as soon as all
// ten digits are in: a number with no ID can be invited ; one that already has a Driver ID shows
// who is on record and a Send swap request button (ExistingDriverPanel), so a driver never gets a second ID.
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useVendorData } from '../../context/VendorData';
import { Sheet, TextField } from '../ui';
import { SingleDocField } from '../fields';
import { Btn, Feedback, Notice } from '../kit/core';
import { Section } from './FormSection';
import { ExistingDriverPanel } from './ExistingDriver';
import { flash } from '../kit/flash';
import { findDriver, type DriverLookup } from '../../services/partnerLinks';
import { inviteDriver, VendorActionError } from '../../services/vendorService';
import { ActionError } from '../../services/callables';
import { formatPhone } from '../../utils/format';
import { describeDataError } from '../../utils/retry';
import { isLicence, normalizeLicence } from '../../utils/fleet';
import { goSection } from '../../navigation/navigationRef';

type Lookup = { key: string; status: 'new' | 'found' | 'error'; data?: DriverLookup; message?: string };

export function DriverForm({ onClose }: { onClose: () => void }) {
  const { identity } = useVendorData();
  const [name, setName] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [licence, setLicence] = useState('');
  const [licenceUrl, setLicenceUrl] = useState('');
  const [selfieUrl, setSelfieUrl] = useState('');
  const [uploads, setUploads] = useState(0);
  const [mobile, setMobile] = useState('');
  const [lookup, setLookup] = useState<Lookup>({ key: '', status: 'new' });
  const [invited, setInvited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const valid = /^[6-9]\d{9}$/.test(mobile);
  useEffect(() => {
    if (!valid || invited) return undefined;
    let alive = true;
    const t = setTimeout(() => {
      findDriver(mobile)
        .then((d) => alive && setLookup({ key: mobile, status: d.found ? 'found' : 'new', data: d }))
        .catch((e: unknown) => alive && setLookup({ key: mobile, status: 'error', message: e instanceof ActionError ? e.message : describeDataError(e) }));
    }, 500);
    return () => { alive = false; clearTimeout(t); };
  }, [mobile, valid, invited]);

  const current = lookup.key === mobile ? lookup : null;
  const checking = valid && !invited && !current;
  const found = valid && current?.status === 'found' ? current.data : undefined;
  const isNew = valid && current?.status === 'new';

  const invite = async () => {
    setSubmitted(true);
    if (!name.trim() || !valid || !isLicence(licence) || !licenceUrl || !selfieUrl) return;
    if (current?.status === 'found') return;
    if (uploads > 0) { setError('Please wait for the upload to finish.'); return; }
    setBusy(true); setError('');
    try { await inviteDriver(identity, mobile, '', name, { number: licence, photoUrl: licenceUrl, selfieUrl }); setInvited(true); flash(`Driver added: ${formatPhone(mobile)}.`); }
    catch (e) { setError(e instanceof VendorActionError ? e.message : describeDataError(e)); }
    finally { setBusy(false); }
  };
  const reset = () => { setLicence(''); setLicenceUrl(''); setSelfieUrl(''); setName(''); setSubmitted(false); setMobile('');  setInvited(false); setError(''); setLookup({ key: '', status: 'new' }); };

  return (
    <Sheet visible onClose={() => !busy && onClose()} dismissible={!busy} title="Add driver">
      <View>
        <Section first title="Driver details" text="Enter the driver’s name and mobile number. We check NESAM records first." />
        <TextField
          label="Full name"
          required
          value={name}
          editable={!busy && !invited}
          onChangeText={(t) => { setName(t); setError(''); }}
          error={submitted && !name.trim() ? 'Enter the driver’s name' : ''}
          placeholder="As on the driving licence"
          autoCapitalize="words"
        />
        <TextField
          label="Mobile number"
          required
          prefix="+91"
          value={mobile}
          keyboardType="phone-pad"
          editable={!busy && !invited}
          onChangeText={(t) => { const digits = t.replace(/\D/g, ''); setMobile(digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits.slice(0, 10)); setError(''); }}
          error={submitted && !valid ? 'Enter the 10-digit mobile number' : ''}
          hint={checking ? 'Checking NESAM records…'
            : !mobile ? 'NESAM records are checked as soon as you enter all 10 digits.'
            : mobile.length < 10 ? `${mobile.length} of 10 digits entered`
            : !valid ? 'Mobile numbers start with 6, 7, 8 or 9.' : undefined}
          placeholder="98765 43210"
        />
        {valid && current?.status === 'error' ? <Notice tone="red" title="Couldn’t check NESAM records" text={current.message || 'Please try again.'} /> : null}
        {isNew && !invited ? <Notice tone="green" icon="checkmark-circle-outline" title="No existing driver ID" text="This number isn’t on NESAM yet, so you can add the driver." /> : null}

        {found ? (
          <ExistingDriverPanel found={found} mobile={mobile} onClose={onClose} onDifferent={reset} />
        ) : invited ? (
          <>
            <Notice tone="green" title="Driver added" text={`NESAM will verify the licence. ${formatPhone(mobile)} can now sign in to the NESAM Driver app with a mobile OTP, and appears in your fleet once they do.`} />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <Btn kind="secondary" icon="people-outline" title="View drivers" onPress={() => { onClose(); goSection('Fleet', { tab: 'Drivers' }); }} style={{ flex: 1 }} />
              <Btn kind="secondary" icon="add" title="Add another" onPress={reset} style={{ flex: 1 }} />
            </View>
          </>
        ) : (
          <>
            <Section title="Licence and photo" text="NESAM verifies these before duties are assigned." />
            <TextField
              label="Driving licence number"
              required
              value={licence}
              onChangeText={(t) => { setLicence(t.toUpperCase()); setError(''); }}
              error={submitted && !isLicence(licence) ? 'Enter a valid licence number (e.g. TN01 20110012345)' : ''}
              hint={licence && isLicence(licence) ? normalizeLicence(licence) : undefined}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="TN01 20110012345"
            />
            <SingleDocField
              label="Driving licence photo"
              vehicleId={`driver-${mobile || 'new'}`}
              folder="drivers"
              kind="licence"
              value={licenceUrl}
              onChange={setLicenceUrl}
              required
              error={submitted && !licenceUrl ? 'Upload the driving licence' : ''}
              onBusyChange={(b) => setUploads((n) => Math.max(0, n + (b ? 1 : -1)))}
            />
            <SingleDocField
              label="Driver selfie"
              vehicleId={`driver-${mobile || 'new'}`}
              folder="drivers"
              kind="selfie"
              value={selfieUrl}
              onChange={setSelfieUrl}
              required
              error={submitted && !selfieUrl ? 'Upload a selfie of the driver' : ''}
              onBusyChange={(b) => setUploads((n) => Math.max(0, n + (b ? 1 : -1)))}
            />
            <Feedback tone="error" message={error} />
            <Btn title={busy ? 'Adding…' : uploads > 0 ? 'Uploading…' : 'Add driver'} icon="person-add-outline" busy={busy} disabled={checking || uploads > 0} full onPress={() => void invite()} />
          </>
        )}
      </View>
    </Sheet>
  );
}
