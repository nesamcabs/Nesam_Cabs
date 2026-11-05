import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Colors } from '../theme/colors';
import { fonts } from '../theme';

export interface PrimaryButtonProps {
  title: string;
  onPress: () => void;
  style?: any;
  disabled?: boolean;
}

export function PrimaryButton({ title, onPress, style, disabled }: PrimaryButtonProps) {
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, disabled ? styles.disabled : null, style]}
    >
      <Text style={styles.text}>{title}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    backgroundColor: Colors.border,
  },
  text: {
    fontFamily: fonts.extraBold,
    color: Colors.white,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
