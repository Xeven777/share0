// Phase 1: the receiver UI ships as a zero-build single-file page
// (see packages/server/src/web.ts) so `share` has no frontend build step.
// This apps/web tree is the future React+Vite home; Phase 5 can migrate the
// receiver here and bundle it into the CLI package.
export {};
