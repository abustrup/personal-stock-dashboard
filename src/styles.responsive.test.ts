import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Layout guards for rules that jsdom cannot exercise.
 *
 * The component tests render in jsdom, which has no layout engine and does not
 * evaluate `@media` queries — so a responsive overflow (an element clipping off
 * the viewport at a given width) is invisible to them. These source assertions
 * pin the specific CSS that prevents such a regression, so a future refactor
 * can't silently drop the rule and bring the clip back.
 */
// Vitest runs with the package root as cwd.
const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

/** The slice of `css` inside the first `@media (max-width: <maxPx>px)` block. */
function mediaBlock(maxPx: number): string {
  const start = css.indexOf(`@media (max-width: ${maxPx}px)`);
  expect(start, `expected an @media (max-width: ${maxPx}px) block`).toBeGreaterThan(-1);
  const next = css.indexOf("@media", start + 1);
  return css.slice(start, next === -1 ? undefined : next);
}

describe("topbar layout at narrow widths", () => {
  it("lets the actions row wrap so the freshness chip + Import CSV never clip off-screen", () => {
    // At <=620px the .topbar stacks to a column, which gives .topbar-actions less
    // horizontal room — and the freshness chip and the Import CSV button are both
    // white-space:nowrap. Without wrapping, they overrun the narrowest phones and the
    // primary action clips off the right edge. The mobile block must let the row wrap.
    const block = mediaBlock(620);
    const rule = block.match(/\.topbar-actions\s*\{[^}]*\}/);
    expect(rule, ".topbar-actions must be styled inside the 620px media block").not.toBeNull();
    expect(rule![0]).toMatch(/flex-wrap:\s*wrap/);
  });
});
