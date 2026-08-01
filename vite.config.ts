import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {viteSingleFile} from 'vite-plugin-singlefile';

export default defineConfig(({mode}) => {
  return {
    plugins: mode === 'standalone' ? [react(), tailwindcss(), viteSingleFile()] : [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // Set DISABLE_HMR=true to turn off HMR (useful when an external tool edits files directly).
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
