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

describe("keyboard focus rings on holding-navigation controls", () => {
  /**
   * The `:focus-visible` state is a keyboard-only concern jsdom cannot render, so
   * we pin it at the source. Every button that navigates to a holding's detail —
   * the ledger row, the reach/peer names, etc. — shares one branded accent ring so
   * the app speaks a single, consistent keyboard-focus vocabulary. The two
   * front-page "in your own trades" buttons (`.trades-top-link`, `.trades-leg-name`)
   * do the same `onSelect(symbol)` navigation, so they must live in that same shared
   * rule, not fall back to the inconsistent browser-default outline.
   */
  const brandedRing = css.match(/\.lt-row:focus-visible,[\s\S]*?\{\s*outline: 2px solid var\(--accent\);[\s\S]*?\}/);

  it("styles the canonical ledger row with the shared accent ring", () => {
    expect(brandedRing, "expected the shared .lt-row:focus-visible accent-ring rule").not.toBeNull();
  });

  it("gives the front-page trades navigation buttons the SAME ring as their siblings", () => {
    // Non-vacuous: dropping either selector from the shared rule fails this.
    expect(brandedRing![0]).toContain(".trades-top-link:focus-visible");
    expect(brandedRing![0]).toContain(".trades-leg-name:focus-visible");
  });
});

describe("rail briefs only signal clickable when they are", () => {
  /**
   * A rail brief with no company to open renders as a plain div rather than a
   * button (see `RailBrief`), so it is neither clickable nor a tab stop. But two
   * of its three false affordances lived in CSS on the shared `.rail-brief`
   * class — the pointer cursor and the accent hover on the headline — and jsdom
   * evaluates neither `cursor` nor `:hover`. The component test pins the element
   * type; these pin the styling, so a future refactor can't drop the `.static`
   * handling and silently give the inert briefs back a hover accent and a
   * pointer while the suite stays green.
   */
  it("gives a brief with nothing to open a default cursor, not a pointer", () => {
    const rule = css.match(/\.rail-brief\.static\s*\{[^}]*\}/);
    expect(rule, "expected a .rail-brief.static rule").not.toBeNull();
    expect(rule![0]).toMatch(/cursor:\s*default/);
  });

  it("withholds the accent hover from a brief with nothing to open", () => {
    // The hover rule must exclude the static variant. Non-vacuous: dropping the
    // `:not(.static)` qualifier fails this.
    const hover = css.match(/\.rail-brief[^{]*:hover\s+\.rail-brief-headline\s*\{[^}]*\}/);
    expect(hover, "expected a .rail-brief hover rule for the headline").not.toBeNull();
    expect(hover![0]).toContain(":not(.static)");
  });
});
