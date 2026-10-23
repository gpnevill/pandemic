import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { gameServer } from './server/gameServer.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), gameServer()],
  server: {
    // let tailnet peers use the host's MagicDNS name (IP addresses are always allowed)
    allowedHosts: ['.ts.net'],
  },
})
