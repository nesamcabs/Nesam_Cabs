// The account menu, shown in two places exactly like the website: as the Account page and inside the profile side
// drawer (opened from the header's menu button). Profile card, then Account / Trips & payments / Help groups and
// Log out. In the drawer the pencil and Emergency contact open their edit forms right below them.
import React, { useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useCustomerData } from '../context/CustomerData';
import { useAuthGate } from '../context/AuthGate';
import { Button, Notice } from './ui';
import { Icon, type IconName } from './Icon';
import { EmergencyContactForm, PersonalDetailsForm } from './ProfileForms';
import { choosePhotoSource } from './photoSource';
import { PickerError, pickImage, uploadProfilePhoto } from '../services/storageService';
import { updateCustomerProfile } from '../services/userService';
import { signOutUser } from '../services/authService';
import { formatINR, formatPhone, initials } from '../utils/format';
import { describeError } from '../utils/retry';
import { COMPANY_LEGAL_NAME } from '../config/constants';
import { useResponsive } from '../theme/responsive';
import { colors, fonts } from '../theme';

/** Each kind of row keeps its own icon colour, so a list reads at a glance. */
type Tone = 'brand' | 'red' | 'blue' | 'green' | 'gold';
const TONE_COLOR: Record<Tone, string> = { brand: colors.primary, red: colors.danger, blue: colors.info, green: colors.success, gold: colors.gold };
/** A 12% tint of the tone on white, as a hex colour with alpha. */
const tint = (c: string) => `${c}1F`;

/** One row: tinted icon tile, label, optional right-hand value, chevron. */
function SettingRow({ icon, tone = 'brand', label, value, onPress, first, expanded }: { icon: IconName; tone?: Tone; label: string; value?: string; onPress: () => void; first?: boolean; expanded?: boolean }) {
  const c = TONE_COLOR[tone];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}. ${value}` : label}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      style={({ pressed }) => [styles.setting, !first && styles.settingDivider, pressed && styles.settingPressed]}
    >
      <View style={[styles.settingIcon, { backgroundColor: tint(c) }]}>
        <Icon name={icon} size={20} color={c} />
      </View>
      <Text style={styles.settingLabel} numberOfLines={2}>
        {label}
      </Text>
      {value ? (
        <Text style={styles.settingValue} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={18} color={colors.faint} />
    </Pressable>
  );
}

/** An eyebrow heading over a rounded list card. Children may be rows or any other node (an open edit form). */
function Group({ title, children }: { title?: string; children: React.ReactNode }) {
  const rows = React.Children.toArray(children).filter(Boolean);
  let n = 0;
  return (
    <View style={styles.group}>
      {title ? (
        <Text style={styles.eyebrow} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      <View style={styles.listCard}>
        {rows.map((row, i) => (
          <React.Fragment key={i}>{React.isValidElement<{ first?: boolean }>(row) && row.type === SettingRow ? React.cloneElement(row, { first: n++ === 0 }) : row}</React.Fragment>
        ))}
      </View>
    </View>
  );
}

type EditView = 'details' | 'emergency';

export function AccountMenu({ variant = 'page', onClose }: { variant?: 'page' | 'drawer'; onClose?: () => void }) {
  const navigation = useNavigation();
  const { isDesktop } = useResponsive();
  const { guest, requestSignIn } = useAuthGate();
  const { profile } = useCustomerData();
  const inDrawer = variant === 'drawer';
  const [photoBusy, setPhotoBusy] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  // Drawer only: the edit form currently open in place (one at a time).
  const [editing, setEditing] = useState<EditView | null>(null);
  const toggleEdit = (view: EditView) => setEditing((now) => (now === view ? null : view));

  /** Closes the drawer (when there is one) and then goes to the page. */
  const go = (run: () => void) => () => {
    onClose?.();
    run();
  };
  const open = (screen: 'Offers' | 'Support' | 'PaymentHistory' | 'Settings' | 'EditProfile' | 'SavedPlaces') => go(() => navigation.navigate(screen));
  const openLegal = go(() => navigation.navigate('LegalDocuments'));
  const openTrips = go(() => navigation.navigate('Tabs', { screen: 'Trips' }));

  // ── Signed out ───────────────────────────────────────────────────────────────
  if (guest || !profile) {
    return (
      <View style={styles.stack}>
        <View style={styles.signedOut}>
          <View style={styles.signedOutArt}>
            <Icon name="user-round" size={30} color={colors.primary} />
          </View>
          <Text style={styles.signedOutTitle}>Sign in to your account</Text>
          <Text style={styles.signedOutText}>Sign in to manage your profile, saved addresses and payment options.</Text>
          <Button
            title="Sign in"
            onPress={() => {
              onClose?.();
              requestSignIn({ title: 'Sign in to account' });
            }}
            style={{ alignSelf: 'stretch' }}
          />
        </View>
        <Group>
          <SettingRow icon="info" tone="gold" label="About NESAM Cabs" onPress={open('Settings')} />
          <SettingRow icon="file-text" tone="brand" label="Terms, privacy & customer policies" onPress={openLegal} />
        </Group>
      </View>
    );
  }

  // ── Signed in ────────────────────────────────────────────────────────────────
  const changePhoto = async () => {
    const source = await choosePhotoSource();
    if (!source) return;
    setError('');
    try {
      const asset = await pickImage(source);
      if (!asset) return;
      setPhotoBusy(0);
      const url = await uploadProfilePhoto(profile.uid, asset, setPhotoBusy);
      await updateCustomerProfile(profile.uid, { photoUrl: url });
    } catch (e) {
      setError(e instanceof PickerError ? e.message : describeError(e, 'Couldn’t update your photo.'));
    } finally {
      setPhotoBusy(null);
    }
  };

  const card = (
    <View style={styles.hero}>
      <Pressable
        onPress={() => void changePhoto()}
        disabled={photoBusy != null}
        accessibilityRole="button"
        accessibilityLabel="Change profile photo"
        style={({ pressed }) => [styles.photoRing, photoBusy != null && { opacity: 0.85 }, pressed && { transform: [{ scale: 0.97 }] }]}
      >
        {profile.photoUrl ? (
          <Image source={{ uri: profile.photoUrl }} style={styles.photo} />
        ) : (
          <View style={[styles.photo, styles.photoInitials]}>
            <Text style={styles.photoInitialsText}>{initials(profile.name)}</Text>
          </View>
        )}
        <View style={styles.cam}>
          <Icon name="camera" size={11} color={colors.white} />
        </View>
      </Pressable>
      <View style={styles.heroInfo}>
        <Text style={styles.heroName} numberOfLines={1}>
          {profile.name}
        </Text>
        {inDrawer ? null : (
          <Text style={styles.heroLine} numberOfLines={1}>
            {formatPhone(profile.phone)}
          </Text>
        )}
        {photoBusy != null ? (
          <Text style={styles.heroLine} numberOfLines={1}>
            Uploading photo… {photoBusy}%
          </Text>
        ) : profile.email && !inDrawer ? (
          <Text style={styles.heroLine} numberOfLines={1}>
            {profile.email}
          </Text>
        ) : null}
      </View>
      <Pressable
        onPress={inDrawer ? () => toggleEdit('details') : open('EditProfile')}
        accessibilityRole="button"
        accessibilityLabel="Edit profile"
        accessibilityState={inDrawer ? { expanded: editing === 'details' } : undefined}
        hitSlop={6}
        style={({ pressed }) => [styles.heroBtn, (pressed || editing === 'details') && { backgroundColor: colors.primarySoft }]}
      >
        <Icon name="pencil" size={16} color={colors.primary} />
      </Pressable>
    </View>
  );

  const credit = (
    <Pressable
      onPress={open('PaymentHistory')}
      accessibilityRole="button"
      accessibilityLabel={`Refund credits ${formatINR(profile.walletBalance)}`}
      style={({ pressed }) => [styles.credit, pressed && styles.creditPressed]}
    >
      <View style={styles.creditIcon}>
        <Icon name="wallet" size={24} color={colors.primary} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={styles.creditLabel}>Refund credits</Text>
        <Text style={styles.creditAmount}>{formatINR(profile.walletBalance)}</Text>
      </View>
      <Icon name="chevron-right" size={20} color={colors.faint} />
    </Pressable>
  );

  const groups = (
    <View style={styles.groups}>
      <Group title="Account">
        <SettingRow
          icon="triangle-alert"
          tone="red"
          label="Emergency contact"
          value={profile.emergencyContact || 'Not set'}
          onPress={inDrawer ? () => toggleEdit('emergency') : open('EditProfile')}
          expanded={inDrawer ? editing === 'emergency' : undefined}
        />
        {inDrawer && editing === 'emergency' ? <EmergencyContactForm onDone={() => setEditing(null)} onCancel={() => setEditing(null)} /> : null}
      </Group>
      <Group title="Trips & payments">
        <SettingRow icon="tickets" tone="brand" label="My trips" onPress={openTrips} />
        <SettingRow icon="receipt-text" tone="green" label="Payments and refunds" onPress={open('PaymentHistory')} />
        <SettingRow icon="tag" tone="gold" label="Offers" onPress={open('Offers')} />
      </Group>
      <Group title="Help">
        <SettingRow icon="headphones" tone="blue" label="Help and support" onPress={open('Support')} />
        <SettingRow icon="info" tone="gold" label="About NESAM Cabs" onPress={open('Settings')} />
        <SettingRow icon="file-text" tone="brand" label="Terms & policies" onPress={openLegal} />
      </Group>
      <View style={styles.group}>
        <View style={styles.listCard}>
          <Pressable onPress={() => setConfirm(true)} accessibilityRole="button" style={({ pressed }) => [styles.setting, pressed && styles.settingPressed]}>
            <View style={[styles.settingIcon, { backgroundColor: tint(colors.primary) }]}>
              <Icon name="log-out" size={18} color={colors.primary} />
            </View>
            <Text style={styles.settingLabel}>Log out</Text>
          </Pressable>
        </View>
        <Text style={styles.legal}>© {COMPANY_LEGAL_NAME.replace(/NESAM/g, 'Nesam')}</Text>
      </View>
    </View>
  );

  const side = (
    <View style={styles.side}>
      {card}
      {inDrawer && editing === 'details' ? (
        <View style={styles.listCard}>
          <PersonalDetailsForm onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />
        </View>
      ) : null}
      {/* Refund credits live on the Payments page; the drawer stays a short menu. */}
      {inDrawer ? null : credit}
    </View>
  );

  return (
    <View>
      <Notice message={error} style={{ marginBottom: 12 }} />
      {!inDrawer && isDesktop ? (
        <View style={styles.desktop}>
          <View style={{ width: 360 }}>{side}</View>
          <View style={{ flex: 1, minWidth: 0 }}>{groups}</View>
        </View>
      ) : (
        <View style={styles.stack}>
          {side}
          {groups}
        </View>
      )}

      <Modal visible={confirm} transparent animationType="fade" onRequestClose={() => setConfirm(false)} statusBarTranslucent>
        <View style={styles.scrim}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setConfirm(false)} accessibilityRole="button" accessibilityLabel="Close" />
          <View style={styles.dialog} accessibilityViewIsModal>
            <Text style={styles.dialogTitle}>Log out of NESAM Cabs?</Text>
            <Text style={styles.dialogText}>You’ll need to verify your mobile number again to sign back in.</Text>
            <View style={{ gap: 8, marginTop: 6 }}>
              <Button title="Stay signed in" variant="secondary" onPress={() => setConfirm(false)} />
              <Button
                title="Log out"
                onPress={() => {
                  setConfirm(false);
                  signOutUser().catch(() => setError('We couldn’t log you out. Please try again.'));
                }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const CARD_SHADOW = { shadowColor: '#14171C', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.07, shadowRadius: 14, elevation: 2 } as const;

const styles = StyleSheet.create({
  stack: { gap: 14 },
  desktop: { flexDirection: 'row', alignItems: 'flex-start', gap: 28 },
  side: { gap: 14 },
  groups: { gap: 18, minWidth: 0 },

  // Signed out
  signedOut: { alignItems: 'center', gap: 10, padding: 22, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  signedOutArt: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  signedOutTitle: { fontFamily: fonts.extraBold, fontSize: 17, color: colors.ink },
  signedOutText: { fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 20, textAlign: 'center', color: colors.muted, marginBottom: 6 },

  // Profile card
  hero: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingLeft: 14, paddingRight: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  photoRing: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.primarySoft },
  photo: { width: 50, height: 50, borderRadius: 25, backgroundColor: colors.border },
  photoInitials: { backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  photoInitialsText: { fontFamily: fonts.semiBold, fontSize: 19, color: colors.primary },
  cam: { position: 'absolute', right: -3, bottom: -3, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, borderWidth: 2, borderColor: colors.white },
  heroInfo: { flex: 1, minWidth: 0, gap: 1 },
  heroName: { fontFamily: fonts.extraBold, fontSize: 16, lineHeight: 21, letterSpacing: -0.1, color: colors.ink },
  heroLine: { fontFamily: fonts.semiBold, fontSize: 12.5, lineHeight: 18, color: colors.muted },
  heroBtn: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },

  // Refund credits
  credit: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, ...CARD_SHADOW },
  creditPressed: { backgroundColor: colors.primarySoft, borderColor: colors.primaryBorder },
  creditIcon: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: tint(colors.primary) },
  creditLabel: { fontFamily: fonts.medium, fontSize: 12.5, lineHeight: 18, color: colors.muted },
  creditAmount: { fontFamily: fonts.extraBold, fontSize: 21, lineHeight: 28, letterSpacing: -0.2, color: colors.ink },

  // Groups and rows
  group: { gap: 8, minWidth: 0 },
  eyebrow: { marginLeft: 4, fontFamily: fonts.extraBold, fontSize: 11.5, lineHeight: 16, letterSpacing: 1.05, textTransform: 'uppercase', color: colors.muted },
  listCard: { borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, overflow: 'hidden', ...CARD_SHADOW },
  setting: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingVertical: 10, paddingHorizontal: 16 },
  settingDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  settingPressed: { backgroundColor: colors.primarySoft },
  settingIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  settingLabel: { flex: 1, minWidth: 0, fontFamily: fonts.semiBold, fontSize: 14.5, lineHeight: 20, color: colors.ink },
  settingValue: { flexShrink: 1, maxWidth: '46%', textAlign: 'right', fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: colors.muted },
  legal: { marginTop: 4, textAlign: 'center', fontFamily: fonts.regular, fontSize: 12, color: colors.muted },

  // Log-out dialog
  scrim: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: 'rgba(15,23,42,0.45)' },
  dialog: { width: '100%', maxWidth: 400, gap: 6, padding: 22, borderRadius: 20, backgroundColor: colors.white },
  dialogTitle: { fontFamily: fonts.extraBold, fontSize: 18, color: colors.ink },
  dialogText: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.muted },
});
