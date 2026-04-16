/// <reference types="vitest/config" />
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/sonification-solar-system/',
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
})
