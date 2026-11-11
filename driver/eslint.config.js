// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // Unreferenced leftovers of the pre-MainNavigator app (they no longer compile); safe to delete.
    ignores: ['dist/*', 'android/*', 'ios/*', 'coverage/*', 'src/context/AuthContext.tsx', 'src/navigation/RootNavigator.tsx', 'src/screens/DashboardScreen.tsx', 'src/screens/MarketplaceScreen.tsx', 'src/screens/TripExecutionScreen.tsx', 'src/screens/DriverProfileScreen.tsx', 'src/screens/auth/DriverAuthScreen.tsx', 'src/services/driverFirestoreService.ts'],
  },
  {
    files: ['jest.setup.js', '__tests__/**'],
    languageOptions: {
      globals: { jest: 'readonly', describe: 'readonly', it: 'readonly', expect: 'readonly', beforeAll: 'readonly', afterAll: 'readonly', beforeEach: 'readonly' },
    },
  },
]);
