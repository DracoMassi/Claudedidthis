import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: 'Claudedidthis2',
  plugins: [react()],
  test: { environment: 'jsdom', globals: true, include: ['tests/**/*.test.{ts,tsx}'] },
});
