/**
 * Device checks. What the phone reports about itself (developer options, root,
 * emulator, mock location, hooking) can be faked by a modified app, so it is only
 * *logged* as a signal for the operations team. The check that decides anything is
 * Google Play Integrity: the app asks Google for a verdict bound to a one-time
 * nonce from our server, and the server decodes and judges it (verifyDeviceIntegrity).
 * Until Play Integrity is configured on the server the server enforces nothing.
 */
import { Platform } from 'react-native';
import * as Application from 'expo-application';
import * as Device from 'expo-device';
import JailMonkey from 'jail-monkey';
import * as AppIntegrity from '@expo/app-integrity';
import { firebaseConfig } from '../config/firebase';
import { callFunction } from './callables';

export interface DeviceReport {
  type: 'developer_options_enabled' | 'usb_debugging_enabled' | 'root_detected' | 'emulator_detected' | 'app_tampered' | 'debuggable_build' | 'mock_location_detected';
  detail: string;
}

const attempt = async <T,>(fn: () => T | Promise<T>, fallback: T): Promise<T> => {
  try {
    return await fn();
  } catch {
    return fallback;
  }
};

/** Everything suspicious about this device right now (no network). */
export async function collectDeviceSignals(): Promise<DeviceReport[]> {
  if (Platform.OS !== 'android') return [];
  const out: DeviceReport[] = [];
  if (Device.isDevice === false) out.push({ type: 'emulator_detected', detail: 'Running on an emulator' });
  if (await attempt(() => JailMonkey.isJailBroken(), false)) out.push({ type: 'root_detected', detail: 'Root indicators found' });
  if (await attempt(() => JailMonkey.isDevelopmentSettingsMode(), false)) out.push({ type: 'developer_options_enabled', detail: 'Developer options are on' });
  if (await attempt(() => JailMonkey.AdbEnabled(), false)) out.push({ type: 'usb_debugging_enabled', detail: 'USB debugging is on' });
  if (await attempt(() => JailMonkey.canMockLocation(), false)) out.push({ type: 'mock_location_detected', detail: 'Mock locations are allowed' });
  if (await attempt(() => JailMonkey.hookDetected(), false)) out.push({ type: 'app_tampered', detail: 'Hooking framework suspected' });
  if (!__DEV__ && (await attempt(() => JailMonkey.isDebuggedMode(), false))) out.push({ type: 'debuggable_build', detail: 'Debugger attached' });
  return out;
}

const reported = new Set<string>();

/** Reports new signals to the server (once per app session each). Never throws. */
export async function reportDeviceSignals(signals: DeviceReport[]): Promise<void> {
  const version = Application.nativeApplicationVersion ?? '';
  await Promise.all(
    signals
      .filter((s) => !reported.has(s.type))
      .map(async (s) => {
        reported.add(s.type);
        await callFunction('reportSecurityEvent', { type: s.type, role: 'driver', platform: 'android', appVersion: version, detail: s.detail }).catch(() => undefined);
      }),
  );
}

export type IntegrityOutcome = 'passed' | 'failed' | 'not_configured' | 'unavailable';

/**
 * Asks Google Play for an integrity verdict and has the server judge it. 'unavailable'
 * means the check could not run (no Play services, no network); it is not treated as a failure.
 */
export async function refreshDeviceIntegrity(): Promise<IntegrityOutcome> {
  if (Platform.OS !== 'android') return 'not_configured';
  try {
    const { nonce } = await callFunction<unknown, { nonce: string }>('getIntegrityNonce', {});
    const projectNumber = process.env.EXPO_PUBLIC_PLAY_INTEGRITY_PROJECT_NUMBER || firebaseConfig.messagingSenderId;
    await AppIntegrity.prepareIntegrityTokenProviderAsync(projectNumber);
    const token = await AppIntegrity.requestIntegrityCheckAsync(nonce);
    const r = await callFunction<unknown, { status: 'passed' | 'failed' | 'not_configured' }>('verifyDeviceIntegrity', {
      token,
      nonce,
      appVersion: Application.nativeApplicationVersion ?? '',
    });
    return r.status;
  } catch {
    return 'unavailable';
  }
}

/** Full start-up check: log local signals, then refresh the server-side verdict. */
export async function runDeviceChecks(): Promise<{ signals: DeviceReport[]; integrity: IntegrityOutcome }> {
  const signals = await collectDeviceSignals();
  await reportDeviceSignals(signals);
  const integrity = await refreshDeviceIntegrity();
  return { signals, integrity };
}

/** Plain-language warning for the driver; never reveals which check would be hard to fake. */
export function describeSignals(signals: DeviceReport[]): string {
  if (!signals.length) return '';
  const names: Record<DeviceReport['type'], string> = {
    developer_options_enabled: 'Developer options are turned on',
    usb_debugging_enabled: 'USB debugging is turned on',
    root_detected: 'This phone appears to be rooted',
    emulator_detected: 'The app is running on an emulator',
    app_tampered: 'The app environment looks modified',
    debuggable_build: 'The app is running in debug mode',
    mock_location_detected: 'Mock locations are allowed on this phone',
  };
  return `${[...new Set(signals.map((s) => names[s.type]))].join('. ')}. Trips may be blocked or reviewed by NESAM operations until this is fixed.`;
}
