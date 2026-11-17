// React Native Web has no native animation module: asking for it only prints "useNativeDriver is not supported" and
// falls back to JS animation anyway. Ask for the native driver on devices only.
import { Platform } from 'react-native';

export const NATIVE_DRIVER = Platform.OS !== 'web';
