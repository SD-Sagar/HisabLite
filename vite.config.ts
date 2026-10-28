import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // relative base so the build works from any folder (and later inside Capacitor)
  base: './',
  // The browser keeps the khata per address, so localhost:5174 would open an empty one.
  // Always use 5173, and refuse to start (rather than quietly move) if it is taken.
  server: { port: 5173, strictPort: true },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'HisabLite — সহজ ডিজিটাল খাতা',
        short_name: 'HisabLite',
        description: 'দোকানের ডিজিটাল খাতা: সহজ হিসাব ও WhatsApp-এ ফর্দ',
        lang: 'bn',
        // the page colour of the default look (পেছনের রং "মুক্তো" with the purple app colour)
        theme_color: '#ebe8f6',
        background_color: '#ebe8f6',
        display: 'standalone',
        start_url: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
});
