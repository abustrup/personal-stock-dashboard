import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    // Keep Vitest's defaults, but never descend into gitignored git worktrees.
    // AGENTS.md recommends one worktree per agent; without this, a nested
    // `.claude/worktrees/*` checkout would be double-collected and run a second,
    // possibly stale, copy of every test against the wrong source tree.
    exclude: [...configDefaults.exclude, "**/.claude/**", "**/worktrees/**"],
  },
});
