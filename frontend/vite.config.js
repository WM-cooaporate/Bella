import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], root: 'frontend', build: { outDir: '../dist', emptyOutDir: true, rollupOptions: { input: { main: 'index.html', admin: 'admin.html' } } }, server: { proxy: { '/api': process.env.BELLA_API_ORIGIN || 'http://localhost:8080' } } });
