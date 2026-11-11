import React, { createContext, forwardRef, useContext } from 'react';
import { StyleSheet, Text as RNText, TextInput as RNTextInput, type TextInputProps, type TextProps, type TextStyle } from 'react-native';
import { POPPINS, poppinsFor, poppinsReady } from '../../theme/fonts';

/**
 * Drop-in replacements for react-native's Text and TextInput that render in Poppins.
 *
 * Every existing style keeps working: a style's fontWeight picks the matching Poppins family (custom fonts are chosen by
 * family on both platforms, and fontWeight is then reset so Android does not fake a second bold). Text without a weight
 * becomes Poppins Regular, except text nested inside another Text, which inherits its parent's face as before.
 * An explicit fontFamily is always respected (the NESAM wordmark uses one).
 */
const Nested = createContext(false);

/** System text scaling is honoured up to this factor (accessibility), so fixed-height controls never clip their labels. */
export const MAX_FONT_SCALE = 1.4;

function faceFor(style: TextProps['style'], nested: boolean): TextStyle | undefined {
  if (!poppinsReady()) return undefined;
  const flat = StyleSheet.flatten(style) as TextStyle | undefined;
  if (flat?.fontFamily) return undefined;
  if (flat?.fontWeight !== undefined) return { fontFamily: poppinsFor(flat.fontWeight), fontWeight: 'normal' };
  return nested ? undefined : { fontFamily: POPPINS.regular };
}

export const Text = forwardRef<RNText, TextProps>(function Text(props, ref) {
  const nested = useContext(Nested);
  const face = faceFor(props.style, nested);
  return (
    <Nested.Provider value>
      <RNText ref={ref} maxFontSizeMultiplier={MAX_FONT_SCALE} {...props} style={face ? [props.style, face] : props.style} />
    </Nested.Provider>
  );
});

export const TextInput = forwardRef<RNTextInput, TextInputProps>(function TextInput(props, ref) {
  const face = faceFor(props.style, false);
  return <RNTextInput ref={ref} maxFontSizeMultiplier={MAX_FONT_SCALE} {...props} style={face ? [props.style, face] : props.style} />;
});

// Instance types, so `useRef<TextInput>()` keeps working where code imports these names.
// eslint-disable-next-line @typescript-eslint/no-redeclare -- a value and its instance type share a name, as in react-native
export type Text = RNText;
// eslint-disable-next-line @typescript-eslint/no-redeclare
export type TextInput = RNTextInput;
