/**
 * Local HTTP preview config (no self-signed certificate) for testing in
 * browsers that refuse the dev cert. `localhost` is still a secure context,
 * so WebXR and the IWER emulator work. Not used for production builds.
 */
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

export default mergeConfig(
  { ...base, plugins: [] },
  defineConfig({
    root: fileURLToPath(new URL('.', import.meta.url)),
    plugins: [iwsdkDev({ https: false })],
    server: { host: 'localhost', port: 5180, strictPort: true },
  }),
);
