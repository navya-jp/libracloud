import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During development, /api is forwarded to the nginx gateway from docker compose (port 8080).
// Set DIRECT_SERVICES=1 to talk to services started individually on ports 4001-4004.
const direct = process.env.DIRECT_SERVICES === '1';
const svc = (port, prefix) => ({
  target: `http://localhost:${port}`,
  rewrite: (p) => p.replace(prefix, ''),
});

const proxy = direct
  ? {
      '/api/auth': svc(4001, '/api/auth'),
      '/api/catalog': svc(4002, '/api/catalog'),
      '/api/circulation': svc(4003, '/api/circulation'),
      '/api/notifications': svc(4004, '/api/notifications'),
      '/files': { target: 'http://localhost:4002' },
    }
  : { '/api': 'http://localhost:8080', '/files': 'http://localhost:8080', '/covers': 'http://localhost:8080' };

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
  build: { outDir: 'dist', sourcemap: false },
});
