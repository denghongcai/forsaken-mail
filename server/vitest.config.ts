import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Integration tests live in the test/ directory
    include: ['test/**/*.test.ts'],
    // One process per test file, so SQLite files and SMTP ports never collide
    pool: 'forks',
    testTimeout: 15000,
  },
})
