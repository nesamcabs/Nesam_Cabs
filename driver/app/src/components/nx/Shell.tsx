import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, RefreshControlProps, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoid } from '../KeyboardAvoid';
import { useNavigation } from '@react-navigation/native';
import { useDriverData } from '../../context/DriverData';
import { usePresence } from '../../hooks/usePresence';
import { EMERGENCY_NUMBER, SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '../../config/constants';
import { nx } from '../../theme/nx';
import { NxBrand } from './Brand';
import { NxDialog } from './Dialog';
import { NxIcon } from './Icon';
import { useLayout } from './layout';
import { NxButton } from './primitives';

// ── Toast + support dialog, shared by every screen ──────────────────────────

interface SupportContext {
  /** A trip code when help is opened from a trip. */
  tripCode?: string;
  /** The trip has started: changes go through the office. */
  started?: boolean;
}

interface ShellValue {
  notify: (kind: 'ok' | 'error', text: string) => void;
  openSupport: (ctx?: SupportContext) => void;
}

const Ctx = createContext<ShellValue>({ notify: () => undefined, openSupport: () => undefined });
export const useShell = () => useContext(Ctx);

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [support, setSupport] = useState<SupportContext | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useCallback((kind: 'ok' | 'error', text: string) => {
    setToast({ kind, text });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 5000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  const value = useMemo<ShellValue>(() => ({ notify, openSupport: (ctx) => setSupport(ctx ?? {}) }), [notify]);
  const insets = useSafeAreaInsets();
  return (
    <Ctx.Provider value={value}>
      {children}
      <SupportDialog visible={support !== null} onClose={() => setSupport(null)} context={support ?? {}} />
      {toast ? (
        <Pressable
          onPress={() => setToast(null)}
          style={[styles.toast, { bottom: insets.bottom + 84 }, toast.kind === 'error' && styles.toastError]}
          accessibilityRole={toast.kind === 'error' ? 'alert' : 'text'}
          accessibilityLiveRegion="polite"
        >
          <Text style={styles.toastText}>{toast.text}</Text>
        </Pressable>
      ) : null}
    </Ctx.Provider>
  );
}

/**
 * Help and emergency options. The reference offers the NESAM office number; production adds the police number that the
 * previous SOS sheet carried, so no safety feature is lost. Cancellation requests are not offered because the backend
 * has no driver cancellation workflow — the office handles changes by phone.
 */
function SupportDialog({ visible, onClose, context }: { visible: boolean; onClose: () => void; context: SupportContext }) {
  return (
    <NxDialog
      visible={visible}
      onClose={onClose}
      eyebrow={context.tripCode ?? 'NESAM DRIVER SUPPORT'}
      title={context.tripCode ? (context.started ? 'Trip started · Office help' : 'Help & office') : 'A helping hand, whenever needed.'}
      footer={
        <>
          <NxButton title="Call NESAM office" icon="phone" onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE}`)} accessibilityLabel={`Call NESAM office on ${SUPPORT_PHONE_DISPLAY}`} />
          <Text style={styles.officeNumber}>{SUPPORT_PHONE_DISPLAY}</Text>
          <Text style={styles.officeNote}>{context.started ? 'Call the office for trip changes or an urgent issue.' : 'Keep your trip ID ready so our team can help.'}</Text>
        </>
      }
    >
      <Text style={styles.helpIntro}>
        {context.tripCode
          ? context.started
            ? 'For changes after starting your duty, call the NESAM office. Our team will handle the next steps.'
            : 'For a duty change or cancellation, call the NESAM office. Any change is made by the NESAM team.'
          : 'For assigned duty changes, documents or settlement questions, contact the NESAM office.'}
      </Text>
      <Pressable style={styles.helpChoice} onPress={() => void Linking.openURL(`tel:${EMERGENCY_NUMBER}`)} accessibilityRole="button" accessibilityLabel={`Call police emergency number ${EMERGENCY_NUMBER}`}>
        <NxIcon name="alert" size={18} color={nx.red} />
        <View style={{ flex: 1 }}>
          <Text style={styles.helpChoiceTitle}>Emergency: police ({EMERGENCY_NUMBER})</Text>
          <Text style={styles.helpChoiceSub}>In danger or an accident, call {EMERGENCY_NUMBER} first.</Text>
        </View>
        <NxIcon name="chevron" size={16} color={nx.muted} />
      </Pressable>
    </NxDialog>
  );
}

// ── Top bar ─────────────────────────────────────────────────────────────────

function NxTopbar({ title, subtitle, onBack }: { title?: string; subtitle?: string; onBack?: () => void }) {
  const navigation = useNavigation();
  const { unreadCount } = useDriverData();
  const { notify, openSupport } = useShell();
  const presence = usePresence(notify);
  const { width, short } = useLayout();
  const narrow = width <= 374;
  return (
    <View style={[styles.topbar, short && { minHeight: 56, paddingVertical: 8 }, onBack && styles.topbarBack]}>
      {onBack ? (
        <Pressable style={styles.backButton} onPress={onBack} hitSlop={6} accessibilityRole="button" accessibilityLabel="Back">
          <NxIcon name="back" size={18} color={nx.ink} />
        </Pressable>
      ) : null}
      <NxBrand title={title} subtitle={subtitle} />
      <View style={styles.actions}>
        <Pressable
          onPress={() => (presence.locked ? notify('error', 'Duty status is locked while you have a trip.') : void presence.toggle())}
          disabled={presence.busy}
          style={[styles.status, !presence.online && styles.statusOff]}
          accessibilityRole="switch"
          accessibilityState={{ checked: presence.online, disabled: presence.busy }}
          accessibilityLabel={presence.locked ? 'Duty status locked during a trip' : presence.online ? 'Online. Go offline' : 'Offline. Go online'}
        >
          <View style={[styles.statusDot, !presence.online && { backgroundColor: nx.faint }]} />
          {narrow ? null : <Text style={[styles.statusText, !presence.online && { color: nx.muted }]}>{presence.online ? 'Online' : 'Offline'}</Text>}
          <View style={[styles.switchTrack, !presence.online && { backgroundColor: '#C9CDD5', alignItems: 'flex-start' }]}>
            <View style={styles.switchKnob} />
          </View>
        </Pressable>
        <Pressable style={styles.iconButton} onPress={() => openSupport()} accessibilityRole="button" accessibilityLabel="Support and emergency SOS">
          <NxIcon name="help" size={19} color={nx.red} />
        </Pressable>
        <Pressable
          style={styles.iconButton}
          onPress={() => navigation.navigate('Notifications')}
          accessibilityRole="button"
          accessibilityLabel={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        >
          <NxIcon name="bell" size={19} color={nx.ink} />
          {unreadCount > 0 ? <View style={styles.bellDot} /> : null}
        </Pressable>
      </View>
    </View>
  );
}

// ── Screen frame ────────────────────────────────────────────────────────────

/** Top bar + scrollable content on the reference's page background. `tabs` leaves room for the bottom bar. */
export function NxScreen({
  children,
  tabs = true,
  refreshControl,
  title,
  subtitle,
  onBack,
}: {
  children: React.ReactNode;
  tabs?: boolean;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  title?: string;
  subtitle?: string;
  /** Shows a Back control at the top-left, beside the page heading. */
  onBack?: () => void;
}) {
  const { wide, width } = useLayout();
  // Phones use the full width; tablets keep a readable column (one column up to 760, two columns up to 1180).
  const gutter = width >= 600 ? 28 : 17;
  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <NxTopbar title={title} subtitle={subtitle} onBack={onBack} />
      <KeyboardAvoid>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 20, paddingHorizontal: gutter, paddingBottom: tabs ? 24 : 40 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
      >
        <View style={{ width: '100%', maxWidth: wide ? 1180 : 760, alignSelf: 'center' }}>
          {children}
          <View style={styles.footer}>
            <NxIcon name="shield" size={11} color="#989DA6" />
            <Text style={styles.footerText}>NESAM TOURS & TRAVELS PRIVATE LIMITED</Text>
          </View>
        </View>
      </ScrollView>
      </KeyboardAvoid>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: nx.page },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 74, paddingHorizontal: 17, paddingVertical: 14, backgroundColor: nx.white, borderBottomWidth: 1, borderBottomColor: nx.line },
  topbarBack: { gap: 8, paddingLeft: 10 },
  backButton: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 9, borderRadius: 24, backgroundColor: nx.statusBg, borderWidth: 1, borderColor: nx.statusBorder },
  statusOff: { backgroundColor: nx.page, borderColor: nx.line },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: nx.statusGreen },
  statusText: { fontSize: 11, fontWeight: '700', color: nx.statusGreen },
  switchTrack: { width: 28, height: 16, borderRadius: 9, backgroundColor: nx.statusGreen, padding: 2, alignItems: 'flex-end', justifyContent: 'center' },
  switchKnob: { width: 12, height: 12, borderRadius: 6, backgroundColor: nx.white },
  iconButton: { width: 40, height: 40, borderRadius: 12, backgroundColor: nx.white, borderWidth: 1, borderColor: nx.line, alignItems: 'center', justifyContent: 'center' },
  bellDot: { position: 'absolute', top: 8, right: 9, width: 8, height: 8, borderRadius: 4, backgroundColor: nx.red, borderWidth: 1.5, borderColor: nx.white },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 28,
    marginBottom: 8,
    width: '100%',
    alignSelf: 'center',
  },
  footerText: {
    fontSize: 11,
    color: '#989DA6',
    textAlign: 'center',
    fontWeight: '500',
    letterSpacing: 0.3,
  },
  toast: { position: 'absolute', left: 17, right: 17, backgroundColor: nx.ink, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 15, elevation: 6 },
  toastError: { backgroundColor: nx.red },
  toastText: { color: nx.white, fontSize: 12.5, fontWeight: '600', lineHeight: 18 },
  helpIntro: { fontSize: 13, lineHeight: 22, color: nx.ink, marginBottom: 14 },
  helpChoice: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 15, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: nx.line },
  helpChoiceTitle: { fontSize: 12.5, fontWeight: '700', color: nx.ink },
  helpChoiceSub: { fontSize: 11, color: nx.muted, marginTop: 2 },
  officeNumber: { fontSize: 13, fontWeight: '700', color: nx.ink, textAlign: 'center', letterSpacing: 0.3 },
  officeNote: { fontSize: 11, color: nx.muted, textAlign: 'center' },
});
