import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/cofia-log/', // ← GitHubリポジトリ名
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'robots.txt'],
      manifest: {
        name: 'coFia Log',
        short_name: 'coFia',
        description: 'Coffee Roast Log with Fia',
        theme_color: '#0f0f10',
        background_color: '#0f0f10',
        display: 'standalone',
        start_url: '/cofia-log/',
        icons: [
          {
            src: '/cofia-log/pwa-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/cofia-log/pwa-512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ]
})
