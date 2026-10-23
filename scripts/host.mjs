// Build the game and host it for multiplayer over Tailscale.
//
//   npm run host            (PORT=5000 npm run host to change the port)
//
// Serves the production build with the game server (server/gameServer.ts),
// listening on all interfaces but answering only this machine and Tailscale
// peers. Prints the links to open on each machine.

import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT) || 4173;

/** This machine's Tailscale IPv4 address and MagicDNS name, as far as we can tell. */
function tailscaleInfo() {
  let ip = null;
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      const m = a.family === 'IPv4' && /^100\.(\d+)\./.exec(a.address);
      if (m && Number(m[1]) >= 64 && Number(m[1]) <= 127) ip = a.address;
    }
  }
  let dnsName = null;
  // the CLI is on PATH for most installs; the Mac App Store app keeps it inside the bundle
  for (const bin of ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale']) {
    try {
      const out = execFileSync(bin, ['status', '--json'], { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
      const self = JSON.parse(out.toString()).Self ?? {};
      dnsName = self.DNSName ? self.DNSName.replace(/\.$/, '') : null;
      ip ??= (self.TailscaleIPs ?? []).find((x) => x.includes('.')) ?? null;
      break;
    } catch {
      // not installed here, or not logged in — try the next location
    }
  }
  return { ip, dnsName };
}

const { ip, dnsName } = tailscaleInfo();
const shortName = dnsName?.split('.')[0];

console.log('Building the game…');
await build({ root, logLevel: 'warn' });

await preview({
  root,
  preview: {
    host: true, // all interfaces; the game server turns away anything that isn't local or on the tailnet
    port,
    strictPort: true,
    // Vite checks the Host header; IP addresses always pass, MagicDNS names need listing
    allowedHosts: ['.ts.net', ...(shortName ? [shortName] : [])],
  },
});

const links = [dnsName && `http://${dnsName}:${port}`, ip && `http://${ip}:${port}`].filter(Boolean);
console.log(`
  🌍 Pandemic is being hosted.

  On this machine:      http://localhost:${port}`);
if (links.length) {
  console.log(`  On the other machine: ${links.join('\n                        ')}`);
} else {
  console.log(`
  ⚠️  No Tailscale address found on this machine — is Tailscale running and logged in?
     Other machines won't be able to connect until it is.`);
}
console.log(`
  Only this machine and devices on your tailnet can connect.
  The game is saved to .pandemic-save.json, so stopping the server keeps it.
  Press Ctrl+C to stop.
`);
