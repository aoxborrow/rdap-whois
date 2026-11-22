import { defineConfig } from 'vitest/config';

// library unit tests (node env). No path aliases: the library uses relative imports only,
// so it resolves the same way here as it will in its own repo.
export default defineConfig({
  test: {
    name: 'rdap-whois',
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
