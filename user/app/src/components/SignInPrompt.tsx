// What a guest sees on pages that need an account (My trips, Profile, Notifications…): the website's page header, a short
// reason and the sign-in sheet one tap away.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Screen } from './ui';
import { AppHeader } from './brand';
import { GoButton } from './BookForm';
import { useAuthGate } from '../context/AuthGate';
import { colors, fonts } from '../theme';

export function SignInPrompt({ title, message }: { title: string; message: string }) {
  const { requestSignIn } = useAuthGate();
  return (
    <Screen header={<AppHeader title={title} />} bg={colors.bg}>
      <View style={styles.card}>
        <Text style={styles.heading}>Sign in to continue</Text>
        <Text style={styles.text}>{message}</Text>
        <GoButton title="Sign in with mobile" onPress={() => requestSignIn({ title: 'Sign in to NESAM Cabs' })} style={{ marginTop: 16 }} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { padding: 20, borderWidth: 1, borderColor: colors.border, borderRadius: 6, backgroundColor: colors.white },
  heading: { fontFamily: fonts.semiBold, fontSize: 18, color: colors.ink },
  text: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: colors.muted, marginTop: 6 },
});
