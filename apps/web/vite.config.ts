import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/auth':    'http://localhost:3001',
      '/health':  'http://localhost:3001',
      '/projects': {
        target: 'http://localhost:3001',
        bypass: (req) => {
          // Browser page navigation → serve SPA, not the API
          if (req.headers.accept?.includes('text/html')) return '/index.html';
        },
      },
      '/runs': {
        target: 'http://localhost:3001',
        bypass: (req) => {
          if (req.headers.accept?.includes('text/html')) return '/index.html';
        },
      },
      '/uploads': 'http://localhost:3001',
    },
  },
});
