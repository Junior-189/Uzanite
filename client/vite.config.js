import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const isCapacitor = process.env.CAPACITOR === 'true';
const isNetlify = process.env.NETLIFY === 'true';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  define: isCapacitor ? {
    'import.meta.env.VITE_API_URL': JSON.stringify('https://uzanite.shop/api'),
  } : {},
  base: isCapacitor ? './' : isNetlify ? '/' : '/admin/',
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/webhook': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Split long-lived dependencies out of the app bundle.
    //
    // Everything used to land in one ~400 KB entry chunk, so ANY application
    // change invalidated React, the router and Dexie too — forcing a full
    // re-download on exactly the slow connections that can least afford it.
    // Separate vendor chunks keep their hashes stable across app releases, so
    // a normal deploy re-downloads only the app code.
    rollupOptions: {
      output: {
        // Vite 8 / rolldown requires the function form.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) {
            return 'vendor-react';
          }
          if (/[\\/]node_modules[\\/](dexie|axios)[\\/]/.test(id)) {
            return 'vendor-data';
          }
          // Heavy, feature-specific libraries: only loaded by the pages that
          // use them (POS scanning, receipt export).
          if (/[\\/]node_modules[\\/](barcode-detector|jsbarcode|zxing)/.test(id)) {
            return 'vendor-scanner';
          }
          return 'vendor';
        },
      },
    },
    // Fail loudly if a chunk regresses badly rather than silently shipping it.
    chunkSizeWarningLimit: 300,
  },
})
