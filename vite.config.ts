import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import parcelMacros from 'unplugin-parcel-macros';
export default defineConfig({ base: './', plugins: [parcelMacros.vite(), react()], optimizeDeps: { exclude: ['@react-spectrum/s2/style'] }, server: { host: '127.0.0.1', port: 5173, strictPort: true } });
