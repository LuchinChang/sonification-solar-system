/// <reference types="vitest/config" />
import { defineConfig } from 'vite'

// `base` is only the gh-pages sub-path for production builds; the dev server
// (and Claude preview proxy) serves from root so `/` doesn't 302-redirect.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/sonification-solar-system/' : '/',
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    globals: true,
    server: {
      deps: {
        // Inline Strudel packages so Vite's bundler handles their imports
        // (avoids Node ESM crash on @kabelsalat/web missing export)
        inline: [/@strudel\//],
      },
    },
  },
}))
