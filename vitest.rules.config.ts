import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/rules/**/*.rules-test.ts'],
    fileParallelism: false,
  },
});
