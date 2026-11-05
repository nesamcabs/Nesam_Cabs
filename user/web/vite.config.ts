import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { aiChatDev } from './scripts/ai-chat-dev';

const here = path.dirname(fileURLToPath(import.meta.url));
const slashes = (p: string) => p.split(path.sep).join('/');
const appSrc = slashes(path.resolve(here, '../app/src'));

/**
 * The website reuses the customer app's pricing, booking, Firestore and callable
 * code from ../app/src, so a fare can never differ between the app and the site.
 * Two of those pieces are tied to native modules and are replaced here:
 *   config/firebase.ts      -> src/platform/firebase.ts      (browser auth persistence)
 *   expo-location           -> src/platform/expoLocation.ts  (navigator.geolocation)
 */
function sharedAppSource(): Plugin {
  return {
    name: 'nesam-shared-app-source',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer) return null;
      const from = slashes(importer);
      if (from.startsWith(appSrc) && /(^|\/)config\/firebase$/.test(source)) {
        return path.resolve(here, 'src/platform/firebase.ts');
      }
      return null;
    },
  };
}

export default defineConfig(({ mode }) => {
  // The shared code reads EXPO_PUBLIC_* (same names as the app); VITE_API_URL is accepted too.
  const env = loadEnv(mode, here, ['VITE_', 'EXPO_PUBLIC_']);
  if (!env.VITE_GOOGLE_SITE_VERIFICATION) {
    env.VITE_GOOGLE_SITE_VERIFICATION = 'GOOGLE_SEARCH_CONSOLE_VERIFICATION_TOKEN_REPLACE_ME';
  }
  const processEnv: Record<string, string> = { NODE_ENV: mode === 'production' ? 'production' : 'development' };
  for (const [k, v] of Object.entries(env)) if (k.startsWith('EXPO_PUBLIC_')) processEnv[k] = v;
  if (env.VITE_API_URL && !processEnv.EXPO_PUBLIC_API_URL) processEnv.EXPO_PUBLIC_API_URL = env.VITE_API_URL;

  // Local development: call the deployed Cloud Functions through this dev server (same origin), so a new localhost port
  // (8085, 8087 …) is never blocked by the functions' CORS list. Not used in production, with the HTTP API or with emulators.
  const projectId = processEnv.EXPO_PUBLIC_FIREBASE_PROJECT_ID || 'nesamtoursandtravels-202f5';
  const proxyFunctions = mode !== 'production' && !processEnv.EXPO_PUBLIC_API_URL && processEnv.EXPO_PUBLIC_USE_FIREBASE_EMULATORS !== 'true';
  if (proxyFunctions) processEnv.EXPO_PUBLIC_FUNCTIONS_PROXY = '/__functions';
  const functionsProxy = {
    '/__functions': { target: `https://us-central1-${projectId}.cloudfunctions.net`, changeOrigin: true, secure: true, rewrite: (p: string) => p.replace(/^\/__functions/, '') },
  };

  return {
    // Files from ../app would otherwise resolve ../app/tsconfig.json, which extends
    // `expo/tsconfig.base` (not installed in the web build). Use this project's config for all files.
    tsconfig: path.resolve(here, 'tsconfig.json'),
    plugins: [
      aiChatDev(),
      sharedAppSource(),
      react(),
      {
        name: 'html-gsc-transform',
        transformIndexHtml(html) {
          if (env.VITE_GOOGLE_SITE_VERIFICATION) {
            return html.replace(
              'GOOGLE_SEARCH_CONSOLE_VERIFICATION_TOKEN_PLACEHOLDER',
              env.VITE_GOOGLE_SITE_VERIFICATION,
            );
          }
          return html;
        },
      },
    ],
    envPrefix: ['VITE_', 'EXPO_PUBLIC_'],
    resolve: {
      alias: {
        '@core': path.resolve(here, '../app/src'),
        '@': path.resolve(here, 'src'),
        'expo-location': path.resolve(here, 'src/platform/expoLocation.ts'),
      },
      // One copy of Firebase and React, whichever folder imports them.
      dedupe: ['firebase', '@firebase/app', '@firebase/auth', '@firebase/firestore', '@firebase/functions', '@firebase/storage', 'react', 'react-dom'],
    },
    define: {
      __DEV__: JSON.stringify(mode !== 'production'),
      'process.env': JSON.stringify(processEnv),
    },
    server: {
      host: '0.0.0.0',
      ...(proxyFunctions ? { proxy: functionsProxy } : {}),
      port: Number(process.env.PORT || 8084),
      fs: { allow: [here, path.resolve(here, '../app')] },
    },
    preview: { host: '0.0.0.0', port: Number(process.env.PORT || 8084), ...(proxyFunctions ? { proxy: functionsProxy } : {}) },
    build: {
      target: 'es2022',
      sourcemap: false,
      chunkSizeWarningLimit: 900,
    },
  };
});
