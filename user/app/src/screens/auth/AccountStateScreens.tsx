import React from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Button, EmptyState, Notice, Screen } from '../../components/ui';
import { AppHeader } from '../../components/brand';
import { SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '../../config/constants';
import { colors, fonts, space } from '../../theme';

export function AccountHoldScreen({ status, onSignOut }: { status: string; onSignOut: () => void }) {
  return (
    <Screen bg={colors.white} header={<AppHeader actions={false} />} kind="narrow">
      <View style={{ marginTop: space.xl }}>
        <EmptyState
          icon="lock-keyhole"
          title="Account on hold"
          message={`${status ? `Your account is currently ${status.toLowerCase()}.` : 'Your account is not active yet.'} Please call ${SUPPORT_PHONE_DISPLAY} for help.`}
          action={
            <View style={{ gap: space.md }}>
              <Button title={`Call ${SUPPORT_PHONE_DISPLAY}`} icon="phone" onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE}`)} />
              <Button title="Sign out" variant="secondary" onPress={onSignOut} />
            </View>
          }
        />
      </View>
    </Screen>
  );
}

export function LoadErrorScreen({ message, onRetry, onSignOut }: { message: string; onRetry: () => void; onSignOut: () => void }) {
  return (
    <Screen bg={colors.white} header={<AppHeader actions={false} />} kind="narrow">
      <View style={{ marginTop: space.xl }}>
        <Text style={styles.title} accessibilityRole="header">
          Couldn’t load your account
        </Text>
        <Notice message={message} />
        <Button title="Try again" icon="refresh-cw" onPress={onRetry} />
        <Button title="Sign out" variant="secondary" onPress={onSignOut} style={{ marginTop: space.md }} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.semiBold, fontSize: 21, letterSpacing: -0.5, color: colors.ink, textAlign: 'center', marginBottom: space.lg },
});
