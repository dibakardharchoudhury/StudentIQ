import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { deflateSync } from 'node:zlib';

function basePath(value: string) {
  if (!/^\/(?:[A-Za-z0-9._~-]+\/)*$/.test(value) || value.includes('..')) {
    throw new Error('VITE_BASE_PATH must be an absolute path ending in /, e.g. /StudentIQ/.');
  }
  return value;
}

// Generate install icons locally; their palette is the Clawpilot light theme.
function icon(size: number) {
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const book = x > size * .23 && x < size * .77 && y > size * .28 && y < size * .70;
      const spine = Math.abs(x - size / 2) < size * .025;
      const rgb = book && !spine ? [255, 255, 255] : [177, 31, 75];
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      rows.set([...rgb, 255], offset);
    }
  }
  function chunk(type: string, data: Buffer) {
    const bytes = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, bytes, checksum]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

function pwa(base: string): Plugin {
  return {
    name: 'studentiq-static-pwa',
    generateBundle(_, bundle) {
      for (const size of [192, 512]) {
        this.emitFile({ type: 'asset', fileName: `icon-${size}.png`, source: icon(size) });
      }
      this.emitFile({
        type: 'asset', fileName: 'manifest.webmanifest',
        source: JSON.stringify({
          id: base, name: 'StudentIQ · Learn together', short_name: 'StudentIQ',
          description: 'Parent-controlled tutoring. Sign in to learn together.',
          start_url: base, scope: base, display: 'standalone', lang: 'en',
          icons: [192, 512].map(size => ({
            src: `${base}icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png',
            purpose: 'any maskable',
          })),
        }),
      });
      // Vite emits transformed HTML after this hook; the known shell must be explicit.
      const files = ['index.html', ...Object.keys(bundle).filter(file => file.startsWith('assets/'))];
      const version = Date.now().toString(36);
      this.emitFile({
        type: 'asset', fileName: 'sw.js',
        source: `const PREFIX = ${JSON.stringify(`studentiq-${base}-`)};
const CACHE = PREFIX + '${version}';
const BASE = ${JSON.stringify(base)};
const STATIC = ${JSON.stringify([...files, 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'].map(file => base + file))};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(STATIC)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith(PREFIX) && key !== CACHE)
    .map(key => caches.delete(key)))));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  const path = url.pathname === BASE && request.mode === 'navigate' ? BASE + 'index.html' : url.pathname;
  // Strict allowlist: never intercept config, auth, API, POSTs or speech traffic.
  if (request.method !== 'GET' || request.headers.has('authorization')
      || url.origin !== self.location.origin || url.search || !STATIC.includes(path)) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const saved = await cache.match(path);
    return saved || fetch(request, { cache: 'no-store' });
  }));
});`,
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const base = basePath(env.VITE_BASE_PATH || '/StudentIQ/');
  return {
    base,
    plugins: [react(), pwa(base)],
    build: { chunkSizeWarningLimit: 1600 },
    test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'], clearMocks: true },
  };
});
