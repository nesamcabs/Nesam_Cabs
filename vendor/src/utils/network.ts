// Last known connectivity, kept current by useNetworkStatus (NetInfo).
// Replaces the Web's `navigator.onLine`, which does not exist in React Native.
let online = true;

export function setOnlineState(value: boolean): void {
  online = value;
}

export function isOnline(): boolean {
  return online;
}
