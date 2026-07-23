import { defineConfig } from 'vitest/config';

// Headless core tests: everything under tests/ imports only from src/core/,
// which has zero dependencies on 'obsidian' or the DOM — no stubs needed.
export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		environment: 'node',
		coverage: {
			provider: 'v8',
			include: ['src/core/**/*.ts'],
			reporter: ['text', 'html'],
		},
	},
});
