// The page shell shared by every workspace screen (reference: `.topbar`, `.workspace`, `.page-footer`, `.toast`, support
// dialog). The navigation itself (sidebar / rail / bottom bar) lives in AppFrame, outside the screens, so it stays put
// while pages change — exactly as the reference website behaves.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, RefreshControlProps, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Text } from './Text';
import { KeyboardAvoid, useKeyboardHeight } from '../KeyboardAvoid';
import { useDriverData } from '../../context/DriverData';
import { usePresence } from '../../hooks/usePresence';
import { COPYRIGHT_HOLDER, EMERGENCY_NUMBER, SUPPORT_EMAIL, SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '../../config/constants';
import { PAGE_TITLES, goTab, useCurrentRoute } from '../../navigation/navItems';
import { nx, nxRadius, nxShadow } from '../../theme/nx';
import { NxBrand } from './Brand';
import { NxDialog } from './Dialog';
import { NxIcon, type NxIconName } from './Icon';
import { NxStrip } from './NxStrip';
import { useLayout } from './layout';
import { NxButton, isHovered } from './primitives';

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
  // On smaller phones the switch alone shows the duty status, which leaves the logo room to stay readable.
  const compact = useWindowDimensions().width < 380 && presence.status !== 'On Trip';
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
      {compact ? null : <Text style={[styles.statusText, !on && { color: '#666D78' }]}>{presence.status === 'On Trip' ? 'On trip' : on ? 'Online' : 'Offline'}</Text>}
      <View style={[styles.toggle, !on && { backgroundColor: '#9BA1AA', alignItems: 'flex-start' }]}>
        <View style={styles.toggleKnob} />
      </View>
    </Pressable>
  );
}

// ── Top bar ─────────────────────────────────────────────────────────────────

export function NxTopbar({ title, subtitle, gutter, status = true }: { title: string; subtitle: string; gutter: number; /** The duty-status switch. The Drive page has its own, on the map. */ status?: boolean }) {
  const navigation = useNavigation();
  const { unreadCount, account } = useDriverData();
  const { openSupport } = useShell();
  const { phone, narrow } = useLayout();
  const name = account.driver.name || 'Driver';
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || 'D';
  // The header of NESAM Partner and NESAM Driver is the same: the brand, then one capsule holding Notifications, Call and
  // the profile, always in that order. Pages with the duty switch show it just before the capsule.
  const actions = (
    <View style={[styles.actions, narrow && { gap: 5 }]}>
      {status ? <NxStatusPill /> : null}
      <View style={styles.dock}>
        <DockButton icon="bell" label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'} dot={unreadCount > 0} onPress={() => navigation.navigate('Notifications')} />
        <View style={styles.dockRule} />
        <DockButton icon="phone" label="Support and emergency help" color={nx.red} onPress={() => openSupport()} />
        <View style={styles.dockRule} />
        {/* The avatar opens the profile and account type. */}
        <Pressable
          onPress={() => goTab('Profile')}
          accessibilityRole="button"
          accessibilityLabel={`${name}, open profile`}
          hitSlop={4}
          style={(s) => [styles.dockAvatar, s.pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.dockInitials} maxFontSizeMultiplier={1.1}>{initials}</Text>
        </Pressable>
      </View>
    </View>
  );
  if (phone) {
    return (
      <View style={[styles.phoneBar, { paddingHorizontal: gutter }]}>
        <NxBrand size={narrow ? 'small' : 'regular'} />
        {actions}
        <NxStrip height={2.5} style={styles.barStrip} />
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

/** One round button inside the header capsule. */
function DockButton({ icon, label, onPress, dot, color = nx.ink }: { icon: NxIconName; label: string; onPress: () => void; dot?: boolean; color?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={4}
      style={(s) => [styles.dockBtn, isHovered(s) && { backgroundColor: nx.white }, s.pressed && { opacity: 0.75 }]}>
      <NxIcon name={icon} size={19} color={color} />
      {dot ? <View style={styles.dockDot} /> : null}
    </Pressable>
  );
}

// ── Screen frame ────────────────────────────────────────────────────────────

/**
 * Top bar + scrollable page on the reference's background. Phones show only the brand bar: no page heading under it.
 */
export function NxScreen({
  children,
  refreshControl,
  title,
  subtitle,
  maxWidth = 1180,
}: {
  children: React.ReactNode;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  /** Overrides the page heading taken from the route. */
  title?: string;
  subtitle?: string;
  /** @deprecated phones no longer show a heading under the brand bar. */
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
            {children}
            <View style={[styles.footer, frame.phone && { justifyContent: 'center' }]}>
              <View style={styles.footerLeft}>
                <NxIcon name="shield" size={12} color={nx.subtle} />
                <Text style={styles.footerText}>{COPYRIGHT_HOLDER}</Text>
              </View>
              {frame.phone ? null : <Text style={styles.footerText}>Made for every mile.</Text>}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoid>
    </SafeAreaView>
  );
}

/**
 * A screen built around a live map instead of a scrolling column of panels: the map fills the whole body, and `children`
 * sit in a compact panel over it — a floating bottom sheet on phones, a side column beside the map on wide screens.
 * `map` is a render prop so the caller's <LiveMap> always gets `fill: true` (no border/radius of its own; this frame
 * supplies the chrome around it). `overlay` floats over the top of the map (location chip, status, next duty) and
 * `floating` sits just above the sheet at the right edge (the locate button).
 */
export function NxMapScreen({
  map,
  children,
  overlay,
  floating,
  title,
  subtitle,
  status = true,
}: {
  map: (opts: { fill: true }) => React.ReactNode;
  children: React.ReactNode;
  overlay?: React.ReactNode;
  floating?: React.ReactNode;
  title?: string;
  subtitle?: string;
  /** Show the duty-status switch in the top bar. */
  status?: boolean;
}) {
  const frame = useFrame();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [routeTitle, routeSubtitle] = PAGE_TITLES[frame.route] ?? ['NESAM Driver', ''];
  const edge = frame.phone ? frame.gutter : 16;
  return (
    <SafeAreaView style={styles.root} edges={frame.sideNav ? ['top', 'right'] : ['top', 'left', 'right']}>
      <NxTopbar title={title ?? routeTitle} subtitle={subtitle ?? routeSubtitle} gutter={frame.gutter} status={status} />
      {frame.dashboard ? (
        <View style={[styles.mapSplit, { paddingHorizontal: frame.gutter, paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.mapPane}>
            {map({ fill: true })}
            {overlay ? (
              <View pointerEvents="box-none" style={[styles.overlay, { padding: edge }]}>
                {overlay}
              </View>
            ) : null}
            {floating ? (
              <View pointerEvents="box-none" style={[styles.floating, { right: edge, bottom: edge }]}>
                {floating}
              </View>
            ) : null}
          </View>
          <ScrollView style={styles.sidePane} contentContainerStyle={{ paddingVertical: 18, paddingLeft: 20 }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <View style={StyleSheet.absoluteFill}>{map({ fill: true })}</View>
          {overlay ? (
            <View pointerEvents="box-none" style={[styles.overlay, { padding: edge }]}>
              {overlay}
            </View>
          ) : null}
          <View pointerEvents="box-none" style={styles.sheetWrap}>
            {floating ? (
              <View pointerEvents="box-none" style={[styles.floatingRow, { paddingHorizontal: edge }]}>
                {floating}
              </View>
            ) : null}
            <View style={[styles.sheet, { maxHeight: height * 0.6 }]}>
              <View style={styles.grabber} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
              <ScrollView contentContainerStyle={{ paddingHorizontal: frame.gutter, paddingTop: 10, paddingBottom: frame.bottomNav ? 18 : insets.bottom + 18 }} keyboardShouldPersistTaps="handled">
                {children}
              </ScrollView>
            </View>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: nx.page },
  mapSplit: { flex: 1, flexDirection: 'row', gap: 20 },
  mapPane: { flex: 1.3, minWidth: 0, borderRadius: nxRadius.panel, borderWidth: 1, borderColor: nx.line, overflow: 'hidden', ...nxShadow },
  sidePane: { flex: 1, minWidth: 0, maxWidth: 420 },
  sheetWrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, gap: 10 },
  floating: { position: 'absolute' },
  floatingRow: { alignItems: 'flex-end', marginBottom: 12 },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: nx.fieldLine, marginTop: 9 },
  sheet: { backgroundColor: nx.white, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: nx.line, shadowColor: '#162033', shadowOpacity: 0.1, shadowRadius: 20, shadowOffset: { width: 0, height: -4 }, elevation: 14 },
  phoneBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 66, paddingTop: 11, paddingBottom: 13, backgroundColor: nx.white },
  barStrip: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  dock: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 42, paddingHorizontal: 3, borderRadius: 21, backgroundColor: '#F7F8FA', borderWidth: 1, borderColor: '#E4E7EC', flexShrink: 0 },
  dockRule: { width: 1, height: 18, backgroundColor: '#E1E5EB' },
  dockBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  dockDot: { position: 'absolute', top: 7, right: 8, width: 9, height: 9, borderRadius: 5, backgroundColor: nx.red, borderWidth: 2, borderColor: nx.white },
  dockAvatar: { width: 34, height: 34, borderRadius: 17, marginLeft: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: nx.ink },
  dockInitials: { fontSize: 11.5, fontWeight: '700', color: nx.white, letterSpacing: 0.4 },
  wideBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, paddingTop: 26, paddingBottom: 18, backgroundColor: nx.page },
  pageTitle: { fontSize: 27, lineHeight: 34, fontWeight: '700', letterSpacing: -0.9, color: nx.ink },
  pageSubtitle: { fontSize: 12.5, color: nx.muted, marginTop: 3 },
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
