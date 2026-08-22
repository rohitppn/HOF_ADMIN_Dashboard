import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Two deployment targets share this build:
//
//   • Railway (bot + dashboard on one host)
//        VITE_BASE=/dashboard/          (default — matches Express `app.use('/dashboard', ...)`)
//        VITE_API_BASE=                 (empty — API calls hit same origin)
//
//   • GitHub Pages (dashboard-only, backend at Railway)
//        VITE_BASE=/HOF_ADMIN_Dashboard/    (must match the repo name for user.github.io hosting)
//        VITE_API_BASE=https://<your-railway-host>.up.railway.app
//
// The workflow at .github/workflows/pages.yml sets both at build time.
export default defineConfig({
  base: process.env.VITE_BASE || '/dashboard/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/dashboard-api': 'http://localhost:3001',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
});
