import preact from '@preact/preset-vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [preact(), tailwindcss()],
  server: {
    port: 5178,
    // The sidecar serves the built app and the API from one origin. During
    // development Vite keeps the UI hot and proxies only the API.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5180',
        changeOrigin: false,
      },
    },
  },
})
