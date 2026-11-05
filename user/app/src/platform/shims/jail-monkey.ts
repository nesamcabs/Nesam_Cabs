// Web stand-in for jail-monkey (root / emulator / hooking detection is a
// native-only concept). Every check reports "nothing suspicious".
const no = async () => false;

const JailMonkey = {
  isJailBroken: no,
  isDevelopmentSettingsMode: no,
  AdbEnabled: no,
  canMockLocation: no,
  hookDetected: no,
  isDebuggedMode: no,
};

export default JailMonkey;
