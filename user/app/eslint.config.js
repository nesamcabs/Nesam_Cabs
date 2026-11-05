// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // Unreferenced leftovers of the pre-MainNavigator app (they no longer compile); safe to delete.
    ignores: ['dist/*', 'android/*', 'ios/*', 'coverage/*', 'src/context/AuthContext.tsx', 'src/navigation/RootNavigator.tsx', 'src/data/mockUserData.ts', 'src/components/PrimaryButton.tsx', 'src/services/firebase.ts'],
  },
  {
    files: ['jest.setup.js', '__tests__/**'],
    languageOptions: {
      globals: { jest: 'readonly', describe: 'readonly', it: 'readonly', expect: 'readonly', beforeAll: 'readonly', afterAll: 'readonly', beforeEach: 'readonly' },
    },
    rules: {
      'import/no-unresolved': 'off',
    },
  },
]);
