// The page shell shared by every workspace screen (reference: `.topbar`, `.workspace`, `.page-footer`, `.toast`, support
// dialog). The navigation itself (sidebar / rail / bottom bar) lives in AppFrame, outside the screens, so it stays put
// while pages change — exactly as the reference website behaves.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, RefreshControlProps, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Text } from './Text';
import { KeyboardAvoid, useKeyboardHeight } from '../KeyboardAvoid';
import { useDriverData } from '../../context/DriverData';
import { usePresence } from '../../hooks/usePresence';
import { EMERGENCY_NUMBER, SUPPORT_EMAIL, SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '../../config/constants';
import { PAGE_TITLES, useCurrentRoute } from '../../navigation/navItems';
import { nx } from '../../theme/nx';
import { NxBrand } from './Brand';
import { NxDialog } from './Dialog';
import { NxIcon } from './Icon';
import { useLayout } from './layout';
import { NxButton, NxIconButton, isHovered } from './primitives';

// ── Frame state ─────────────────────────────────────────────────────────────

/** Routes shown without the phone bottom bar (full-screen camera and the document form). */
const NO_BOTTOM_NAV = ['PreTrip', 'UpdateDocuments'];

/** Layout + which navigation chrome is visible for the focused route. */
export function useFrame() {
  const layout = useLayout();
  const route = useCurrentRoute();
  const keyboardOpen = useKeyboardHeight() > 0;
  return { ...layout, route, bottomNav: layout.phone && !NO_BOTTOM_NAV.includes(route) && !keyboardOpen, sideNav: !layout.phone };
}

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
    timer.current = setTimeout(() => setToast(null), 4200);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  const value = useMemo<ShellValue>(() => ({ notify, openSupport: (ctx) => setSupport(ctx ?? {}) }), [notify]);
  const insets = useSafeAreaInsets();
  const frame = useFrame();
  const bottom = frame.bottomNav ? insets.bottom + 84 : insets.bottom + 24;
  return (
    <Ctx.Provider value={value}>
      {children}
      <SupportDialog visible={support !== null} onClose={() => setSupport(null)} context={support ?? {}} />
      {toast ? (
        <View pointerEvents="box-none" style={[styles.toastWrap, { bottom, left: frame.sidebarWidth }]}>
          <Pressable
            onPress={() => setToast(null)}
            style={[styles.toast, toast.kind === 'error' && styles.toastError]}
            accessibilityRole={toast.kind === 'error' ? 'alert' : 'text'}
            accessibilityLiveRegion="polite"
          >
            <NxIcon name={toast.kind === 'error' ? 'alert' : 'check'} size={16} color={nx.white} />
            <Text style={styles.toastText}>{toast.text}</Text>
          </Pressable>
        </View>
      ) : null}
    </Ctx.Provider>
  );
}

/**
 * Help and emergency options: the NESAM office (reference) plus the police number, so a driver always has an SOS route.
 */
function SupportDialog({ visible, onClose, context }: { visible: boolean; onClose: () => void; context: SupportContext }) {
  return (
    <NxDialog
      visible={visible}
      onClose={onClose}
      eyebrow={context.tripCode ?? 'NESAM driver support'}
      title={context.tripCode ? (context.started ? 'Trip started · Office help' : 'Help & office') : 'A helping hand, whenever needed.'}
      footer={
        <>
          <NxButton title="Call NESAM office" icon="phone" onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE}`)} accessibilityLabel={`Call NESAM office on ${SUPPORT_PHONE_DISPLAY}`} />
          <Text style={styles.footnote}>Opens your device’s calling app.</Text>
        </>
      }
    >
      <Text style={styles.helpIntro}>
        {context.tripCode
          ? context.started
            ? 'For changes after starting your duty, call the NESAM office. Our team will handle the next steps.'
            : 'For a duty change, call the NESAM office. Any change is made by the NESAM team.'
          : 'For assigned duty changes, documents or settlement questions, contact the NESAM office.'}
      </Text>
      <Text style={styles.supportPhone}>{SUPPORT_PHONE_DISPLAY}</Text>
      <Text style={styles.helpSub}>Keep your trip ID ready so our team can help.</Text>
      <HelpChoice icon="alert" title={`Emergency: police (${EMERGENCY_NUMBER})`} sub={`In danger or an accident, call ${EMERGENCY_NUMBER} first.`} danger onPress={() => void Linking.openURL(`tel:${EMERGENCY_NUMBER}`)} />
      <HelpChoice icon="document" title="Email NESAM" sub={SUPPORT_EMAIL} onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)} />
    </NxDialog>
  );
}

function HelpChoice({ icon, title, sub, onPress, danger }: { icon: 'alert' | 'document'; title: string; sub: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable style={(s) => [styles.helpChoice, isHovered(s) && { backgroundColor: nx.page }]} onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>
      <NxIcon name={icon} size={18} color={danger ? nx.red : nx.muted} />
      <View style={{ flex: 1 }}>
        <Text style={styles.helpChoiceTitle}>{title}</Text>
        <Text style={styles.helpChoiceSub}>{sub}</Text>
      </View>
      <NxIcon name="chevron" size={16} color={nx.muted} />
    </Pressable>
  );
}

// ── Online / offline pill (reference `.header-status`) ──────────────────────

export function NxStatusPill() {
  const { notify } = useShell();
  const presence = usePresence(notify);
  const { narrow } = useLayout();
  const on = presence.online;
  return (
    <Pressable
      onPress={() => (presence.locked ? notify('error', 'Duty status is locked while you have an active trip.') : void presence.toggle())}
      disabled={presence.busy}
      style={(s) => [styles.status, !on && styles.statusOff, isHovered(s) && { opacity: 0.9 }, presence.busy && { opacity: 0.6 }]}
      accessibilityRole="switch"
      accessibilityState={{ checked: on, disabled: presence.busy }}
      accessibilityLabel={presence.locked ? 'Duty status locked during a trip' : on ? 'Online. Go offline' : 'Offline. Go online'}
    >
      {narrow ? null : <View style={[styles.statusDot, !on && { backgroundColor: '#818792' }]} />}
      <Text style={[styles.statusText, !on && { color: '#666D78' }]}>{presence.status === 'On Trip' ? 'On trip' : on ? 'Online' : 'Offline'}</Text>
      <View style={[styles.toggle, !on && { backgroundColor: '#9BA1AA', alignItems: 'flex-start' }]}>
        <View style={styles.toggleKnob} />
      </View>
    </Pressable>
  );
}

// ── Top bar ─────────────────────────────────────────────────────────────────

function NxTopbar({ title, subtitle, gutter }: { title: string; subtitle: string; gutter: number }) {
  const navigation = useNavigation();
  const { unreadCount } = useDriverData();
  const { openSupport } = useShell();
  const { phone, narrow } = useLayout();
  const actions = (
    <View style={[styles.actions, narrow && { gap: 5 }]}>
      <NxStatusPill />
      <NxIconButton icon="help" label="Support and emergency help" color={nx.red} onPress={() => openSupport()} size={narrow ? 37 : 40} />
      <NxIconButton
        icon="bell"
        label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        dot={unreadCount > 0}
        onPress={() => navigation.navigate('Notifications')}
        size={narrow ? 37 : 40}
      />
    </View>
  );
  if (phone) {
    return (
      <View style={[styles.phoneBar, { paddingHorizontal: gutter }]}>
        <NxBrand size={narrow ? 'small' : 'regular'} />
        {actions}
      </View>
    );
  }
  return (
    <View style={[styles.wideBar, { paddingHorizontal: gutter }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.pageTitle} accessibilityRole="header" numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.pageSubtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      {actions}
    </View>
  );
}

// ── Screen frame ────────────────────────────────────────────────────────────

/**
 * Top bar + scrollable page on the reference's background. On phones a page heading is shown under the brand bar for every
 * page except Home and the trip pages (the reference's `.mobile-page-heading`).
 */
export function NxScreen({
  children,
  refreshControl,
  title,
  subtitle,
  phoneHeading = true,
  maxWidth = 1180,
}: {
  children: React.ReactNode;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  /** Overrides the page heading taken from the route. */
  title?: string;
  subtitle?: string;
  /** Show the big heading under the brand bar on phones. */
  phoneHeading?: boolean;
  /** Content column width on large screens. */
  maxWidth?: number;
  /** @deprecated kept for older call sites; the frame decides the bottom bar. */
  tabs?: boolean;
}) {
  const frame = useFrame();
  const insets = useSafeAreaInsets();
  const [routeTitle, routeSubtitle] = PAGE_TITLES[frame.route] ?? ['NESAM Driver', ''];
  const heading = title ?? routeTitle;
  const caption = subtitle ?? routeSubtitle;
  const showPhoneHeading = frame.phone && phoneHeading && frame.route !== 'Home' && frame.route !== 'Tabs';
  return (
    <SafeAreaView style={styles.root} edges={frame.sideNav ? ['top', 'right'] : ['top', 'left', 'right']}>
      <NxTopbar title={heading} subtitle={caption} gutter={frame.gutter} />
      <KeyboardAvoid>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingTop: frame.phone ? 18 : 6, paddingHorizontal: frame.gutter, paddingBottom: (frame.bottomNav ? 24 : 32) + (frame.bottomNav ? 0 : insets.bottom) }}
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl}
        >
          <View style={{ width: '100%', maxWidth, alignSelf: 'center' }}>
            {showPhoneHeading ? (
              <Text style={styles.phoneHeading} accessibilityRole="header">
                {heading}
              </Text>
            ) : null}
            {children}
            <View style={[styles.footer, frame.phone && { justifyContent: 'center' }]}>
              <View style={styles.footerLeft}>
                <NxIcon name="shield" size={12} color={nx.subtle} />
                <Text style={styles.footerText}>{'NESAM TOURS & TRAVELS PRIVATE LIMITED'}</Text>
              </View>
              {frame.phone ? null : <Text style={styles.footerText}>Made for every mile.</Text>}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoid>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: nx.page },
  phoneBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 72, paddingVertical: 13, backgroundColor: nx.white, borderBottomWidth: 1, borderBottomColor: nx.line },
  wideBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, paddingTop: 26, paddingBottom: 18, backgroundColor: nx.page },
  pageTitle: { fontSize: 27, lineHeight: 34, fontWeight: '700', letterSpacing: -0.9, color: nx.ink },
  pageSubtitle: { fontSize: 12.5, color: nx.muted, marginTop: 3 },
  phoneHeading: { fontSize: 22, fontWeight: '700', letterSpacing: -0.6, color: nx.ink, marginBottom: 18 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 0 },
  status: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 40, paddingVertical: 7, paddingHorizontal: 9, borderRadius: 24, backgroundColor: nx.statusBg, borderWidth: 1, borderColor: nx.statusBorder },
  statusOff: { backgroundColor: '#F0F1F3', borderColor: '#E2E4E8' },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: nx.statusGreen },
  statusText: { fontSize: 11.5, fontWeight: '600', color: nx.statusGreen },
  toggle: { width: 26, height: 16, borderRadius: 10, backgroundColor: '#168557', padding: 3, alignItems: 'flex-end', justifyContent: 'center', marginLeft: 2 },
  toggleKnob: { width: 10, height: 10, borderRadius: 5, backgroundColor: nx.white },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 28, marginBottom: 4 },
  footerLeft: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  footerText: { fontSize: 10, color: nx.subtle, letterSpacing: 0.2 },
  toastWrap: { position: 'absolute', right: 0, alignItems: 'center', paddingHorizontal: 16 },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: 480, backgroundColor: nx.ink, borderRadius: 11, paddingVertical: 13, paddingHorizontal: 18, shadowColor: '#111', shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  toastError: { backgroundColor: nx.redDark },
  toastText: { flexShrink: 1, color: nx.white, fontSize: 12.5, fontWeight: '500', lineHeight: 18 },
  footnote: { fontSize: 11, color: nx.muted, textAlign: 'center' },
  helpIntro: { fontSize: 12.5, lineHeight: 20, color: nx.muted },
  supportPhone: { fontSize: 26, fontWeight: '700', letterSpacing: -0.5, color: nx.ink, marginVertical: 12 },
  helpSub: { fontSize: 11.5, color: nx.muted, marginBottom: 10 },
  helpChoice: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 14, paddingHorizontal: 4, borderTopWidth: StyleSheet.hairlineWidth, borderColor: nx.line },
  helpChoiceTitle: { fontSize: 12.5, fontWeight: '600', color: nx.ink },
  helpChoiceSub: { fontSize: 11, color: nx.muted, marginTop: 2 },
});
