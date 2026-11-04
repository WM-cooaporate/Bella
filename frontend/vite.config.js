import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], root: 'frontend', build: { outDir: '../dist', emptyOutDir: true, rollupOptions: { input: { main: 'index.html', admin: 'admin.html' } } }, server: { proxy: { '/api': 'http://localhost:3000' } } });
