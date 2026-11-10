// The Design Chamber OpenCode plugin (docs: documentation/specs/phase-1-5-sdk-2-7.md §U3.3).
// Built to dist/plugin/index.js by scripts/build.mjs, which fails if this file's output imports
// anything: OpenCode loads it with a bare import() where nothing is installed.
//
// Placeholder: registers no tool yet. The check-tool branch (U3) adds `design_check` here.

export default {
  id: 'design-chamber',
  setup: (): void => undefined,
};
