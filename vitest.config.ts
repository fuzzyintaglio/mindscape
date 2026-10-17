import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts, whose root is ui/.
export default defineConfig({
  test: {
    root: '.',
    include: ['tests/**/*.test.ts'],
  },
});
