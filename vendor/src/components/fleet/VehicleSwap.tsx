// Moving a vehicle that is already on NESAM into this fleet. Two ways, both shown at once:
//   1. Send an OTP to the driver who ran the vehicle most recently; entering the code moves the vehicle to this fleet.
//   2. Call the NESAM office and ask them to swap it; the office moves it from the admin panel.
// When nobody has driven the vehicle recently there is nobody to send a code to, so only the call option is offered.
import React, { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Text } from '../kit/Text';
import { Ionicons } from '@expo/vector-icons';
import { useVendorData } from '../../context/VendorData';
import { Btn, Feedback, Notice, Small } from '../kit/core';
import { requestVehicleLink, type LinkRequestResult, type VehicleLookup } from '../../services/partnerLinks';
import { CodePanel } from '../../screens/fleet/sheets';
import { SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '../../config/constants';
import { plate as spaced } from '../kit/format';
import { colors, fontFamily } from '../../theme';

function Option({ icon, title, text, children }: { icon: React.ComponentProps<typeof Ionicons>['name']; title: string; text: string; children: React.ReactNode }) {
  return (
    <View style={styles.option}>
      <View style={styles.head}>
        <View style={styles.icon}><Ionicons name={icon} size={18} color={colors.primary} /></View>
        <Text style={styles.title}>{title}</Text>
      </View>
      <Text style={styles.text}>{text}</Text>
      <View style={{ marginTop: 12, gap: 8 }}>{children}</View>
    </View>
  );
}

export function VehicleSwap({ found: f, reg, onSent }: { found: VehicleLookup; reg: string; onSent?: (linkId: string) => void }) {
  const { links } = useVendorData();
  const [result, setResult] = useState<LinkRequestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const link = result ? links.find((l) => l.id === result.linkId) : undefined;
  if (f.mine || f.pendingLinkId) return null;

  const sendCode = async () => {
    setBusy(true); setError('');
    try {
      const r = await requestVehicleLink(reg, false);
      setResult(r);
      onSent?.(r.linkId);
    } catch (e) { setError(e instanceof Error ? e.message : 'The request could not be sent.'); } finally { setBusy(false); }
  };

  if (result) return link ? <CodePanel link={link} testCode={result.testCode} /> : <Notice tone="blue" title="Request sent" text="Loading its status…" />;

  const last = f.otpReceiver;
  const blockedByDuty = (f.openDuties ?? 0) > 0;
  return (
    <View style={{ gap: 12 }}>
      {f.onHold ? <Notice tone="amber" title="Vehicle on hold" text="Only the NESAM office can move it. Call NESAM to swap it." /> : null}
      {blockedByDuty ? <Notice tone="amber" title="Duties to resolve" text={`It has ${f.openDuties} booked ${f.openDuties === 1 ? 'duty' : 'duties'} that must be reassigned before it can move.`} /> : null}
      <Text style={styles.lead}>How would you like to swap this vehicle?</Text>

      {last && !f.onHold ? (
        <Option icon="shield-checkmark-outline" title="Send OTP to the last driver"
          text={`We send a code to ${last.name} (${last.phoneMask}), who drove this vehicle most recently. They read it to you, you enter it here, and the vehicle moves to your fleet.`}>
          <Feedback tone="error" message={error} />
          <Btn title={`Send OTP to ${last.name}`} icon="paper-plane-outline" busy={busy} full onPress={() => void sendCode()} />
        </Option>
      ) : null}

      <Option icon="call-outline" title="Call NESAM to swap"
        text={`Call the NESAM office and ask them to swap ${spaced(f.plate ?? reg)} to your fleet. ${last && !f.onHold ? 'Use this if the last driver cannot be reached.' : 'No driver can confirm this vehicle by code, so the office verifies it with you.'}`}>
        <Btn kind={last && !f.onHold ? 'secondary' : 'primary'} icon="call-outline" title={`Call NESAM ${SUPPORT_PHONE_DISPLAY}`} full onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE}`)} />
        <Small>Keep the registration number ready: {spaced(f.plate ?? reg)}</Small>
      </Option>
    </View>
  );
}

const styles = StyleSheet.create({
  lead: { fontFamily, fontSize: 13, fontWeight: '600', color: colors.ink },
  option: { borderWidth: 1, borderColor: '#E7EAF0', borderRadius: 14, padding: 16, backgroundColor: colors.white },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontFamily, fontSize: 14, fontWeight: '700', color: colors.ink },
  text: { fontFamily, fontSize: 12.5, lineHeight: 19, color: colors.muted, marginTop: 10 },
});
