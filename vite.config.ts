import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

declare const process: { env: Record<string, string | undefined> };

// SINGLEFILE=1 builds one self-contained .html (for download-and-play
// from file://, which is a secure context so getUserMedia works).
const singleFile = process.env.SINGLEFILE === '1';

export default defineConfig({
  plugins: [
    ...(singleFile ? [viteSingleFile({ useRecommendedBuildConfig: true })] : []),
    // Single-file builds inline all JS, so the CSP must permit inline scripts.
    // (Locally-opened file: the file IS the app, no XSS vector.)
    {
      name: 'singlefile-csp',
      apply: 'build',
      transformIndexHtml(html: string) {
        if (!singleFile) return html;
        return html.replace(
          "script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval';",
          "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net 'wasm-unsafe-eval';",
        );
      },
    },
  ],
  define: {
    // Lets the tracking client inline its worker (separate worker files
    // can't load from file:// due to CORS).
    __INLINE_WORKER__: singleFile,
  },
  worker: {
    // Workers bundled as ES modules; MediaPipe is dynamically imported
    // inside the worker so it lands in its own chunk.
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: singleFile
        ? {}
        : {
            manualChunks: {
              three: ['three'],
            },
          },
    },
  },
  server: {
    host: true,
    headers: {
      // Webcam requires a secure context; these help when served with TLS.
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
});
