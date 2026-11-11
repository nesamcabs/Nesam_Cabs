// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // Unreferenced leftovers of the pre-MainNavigator app (they no longer compile); safe to delete.
    ignores: ['dist/*', 'android/*', 'ios/*', 'coverage/*', 'src/screens/auth/VendorAuthScreen.tsx', 'src/screens/main/DashboardScreen.tsx', 'src/screens/main/DriversScreen.tsx', 'src/screens/main/FleetScreen.tsx', 'src/screens/main/MarketplaceScreen.tsx', 'src/screens/main/ProfileScreen.tsx', 'src/screens/main/TripAssignmentScreen.tsx', 'src/screens/main/WalletScreen.tsx', 'src/context/AuthContext.tsx', 'src/services/firebase.ts', 'src/services/vendorFirestoreService.ts'],
  },
  {
    files: ['jest.setup.js', '__tests__/**'],
    languageOptions: {
      globals: { jest: 'readonly', describe: 'readonly', it: 'readonly', expect: 'readonly', beforeAll: 'readonly', afterAll: 'readonly', beforeEach: 'readonly' },
    },
  },
]);
