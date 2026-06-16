import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Run the type-level assertions (expectTypeOf / exhaustiveness) as part of
    // `pnpm test`, in addition to the runtime expectations. A union that stops
    // being closed (or an array that drifts from its derived union) fails here.
    typecheck: {
      enabled: true,
      tsconfig: './tsconfig.json',
      include: ['test/**/*.test.ts'],
    },
  },
});
