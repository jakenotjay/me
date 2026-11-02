// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
    site: 'https://jakenotjay.github.io',
    base: '/me',
    vite: {
        // deck.gl-geotiff decodes tiles in module workers.
        worker: { format: 'es' },
        // @developmentseed/lzw-tiff-decoder uses top-level await.
        build: { target: 'es2022' },
        optimizeDeps: {
            esbuildOptions: { target: 'es2022' },
            // The geotiff decoder pool starts `new Worker(new URL("./worker.js",
            // import.meta.url))`; pre-bundling breaks that relative URL in dev.
            exclude: ['@developmentseed/geotiff'],
        },
    },
});
