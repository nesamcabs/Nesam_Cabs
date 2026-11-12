import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

// Vite config — https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: parseInt(process.env.PORT || '8443'),
    strictPort: true,
    // The admin calls the booking server through its own address (/api/...), so the browser never makes a cross-site request and
    // the API's allowed-websites list (CORS) cannot block it. On Vercel the same job is done by the rewrite in vercel.json.
    proxy: { '/api': { target: 'https://nesam-travels-api.vercel.app', changeOrigin: true, secure: true } },
  },

  preview: {
    host: '0.0.0.0',
    port: parseInt(process.env.PORT || '8443'),
  },
})
