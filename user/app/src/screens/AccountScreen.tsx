// Account page. The same menu as the profile side drawer (components/AccountMenu), laid out as a page:
// profile card and refund credits, then the Account / Trips & payments / Help groups and Log out.
import React from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAvoid } from '../components/KeyboardAvoid';
import { ScrollView } from '../components/layout';
import { AppHeader } from '../components/brand';
import { AccountMenu } from '../components/AccountMenu';
import { useDockPad } from '../context/Dock';
import { useResponsive } from '../theme/responsive';
import { colors, space } from '../theme';

export function AccountScreen() {
  const { isDesktop } = useResponsive();
  const dockPad = useDockPad();
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <KeyboardAvoid>
        <AppHeader title="Account" />
        <ScrollView footer kind={isDesktop ? 'medium' : 'narrow'} contentContainerStyle={[styles.page, { paddingBottom: space.xxl + dockPad }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <AccountMenu variant="page" />
        </ScrollView>
      </KeyboardAvoid>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  page: { paddingHorizontal: space.xl, paddingTop: space.md },
});
