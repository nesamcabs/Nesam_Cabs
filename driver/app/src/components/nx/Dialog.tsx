import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { nx, nxRadius } from '../../theme/nx';
import { NxIcon } from './Icon';
import { KeyboardAvoid } from '../KeyboardAvoid';

interface Props {
  visible: boolean;
  onClose: () => void;
  eyebrow?: string;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Blocks back-button / backdrop / ✕ dismissal while something is saving. */
  locked?: boolean;
}

/** The reference's modal: eyebrow + title + round ✕ over a scrollable body and a footer, on a dimmed backdrop. */
export function NxDialog({ visible, onClose, eyebrow, title, children, footer, locked = false }: Props) {
  const close = () => {
    if (!locked) onClose();
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <View style={styles.backdrop} />
      {/* The app is edge-to-edge, so Android does not resize the window for the keyboard: KeyboardAvoid lifts the card above it
          (and above the navigation bar); the body scrolls inside whatever height is left, keeping the footer on screen. */}
      <KeyboardAvoid>
        <View style={styles.fill}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close dialog" accessibilityRole="button" />
        <View style={styles.card} accessibilityViewIsModal>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
              <Text style={styles.title} accessibilityRole="header">
                {title}
              </Text>
            </View>
            <Pressable style={[styles.close, locked && { opacity: 0.4 }]} onPress={close} accessibilityRole="button" accessibilityLabel="Close dialog" hitSlop={6}>
              <NxIcon name="close" size={17} color={nx.ink} />
            </Pressable>
          </View>
          <ScrollView style={styles.body} contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
            {children}
          </ScrollView>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
        </View>
      </KeyboardAvoid>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 15, paddingVertical: 12 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: nx.backdrop },
  card: { width: '100%', maxWidth: 460, maxHeight: '88%', backgroundColor: nx.white, borderRadius: nxRadius.dialog, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: nx.line },
  eyebrow: { fontSize: 10, letterSpacing: 1.6, fontWeight: '700', color: nx.muted, marginBottom: 4 },
  title: { fontSize: 18, fontWeight: '700', letterSpacing: -0.3, color: nx.ink },
  close: { width: 33, height: 33, borderRadius: 17, backgroundColor: nx.page, alignItems: 'center', justifyContent: 'center' },
  // flexShrink lets the body give up height (and scroll) when the card hits maxHeight, so the footer is never clipped.
  body: { flexGrow: 0, flexShrink: 1 },
  footer: { padding: 20, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: nx.line, gap: 10 },
});
