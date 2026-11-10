// Metro config: Expo defaults, plus web-only stand-ins for the few packages that
// have no browser implementation. Android / iOS resolution is untouched.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const WEB_SHIMS = {
  '@react-native-community/datetimepicker': path.join(__dirname, 'src/platform/shims/datetimepicker.ts'),
  'jail-monkey': path.join(__dirname, 'src/platform/shims/jail-monkey.ts'),
  '@expo/app-integrity': path.join(__dirname, 'src/platform/shims/app-integrity.ts'),
};

const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && WEB_SHIMS[moduleName]) {
    return { type: 'sourceFile', filePath: WEB_SHIMS[moduleName] };
  }
  return defaultResolve ? defaultResolve(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
