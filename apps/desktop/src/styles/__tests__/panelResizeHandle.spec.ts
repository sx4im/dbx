import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { wcagContrastRatio } from "@/lib/app/appTheme";

const stylesDir = path.resolve(__dirname, "..");
const globalsCss = readFileSync(path.join(stylesDir, "globals.css"), "utf8");

type Rgb = [number, number, number];

/** The declaration block of the base `.panel-resize-handle::before` rule — the idle grip dots. */
function idleGripRule(): string {
  const match = globalsCss.match(/\.panel-resize-handle::before\s*\{([^}]*)\}/);
  expect(match, "globals.css must define .panel-resize-handle::before").not.toBeNull();
  return match![1];
}

/** Declarations of the `html.theme-soft` (light) or `html.theme-soft.dark` theme block. */
function themeBlock(dark: boolean): string {
  const selector = dark ? String.raw`html\.theme-soft\.dark` : String.raw`html\.theme-soft`;
  const match = globalsCss.match(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`));
  expect(match, `globals.css must define ${dark ? "html.theme-soft.dark" : "html.theme-soft"}`).not.toBeNull();
  return match![1];
}

function themeRgb(block: string, token: string): Rgb {
  const match = block.match(new RegExp(`${token}:\\s*rgb\\(\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)\\s*\\)`));
  expect(match, `theme block must define ${token}`).not.toBeNull();
  return [Number(match![1]), Number(match![2]), Number(match![3])];
}

/** Effective alpha of the dots: the rule's opacity, times any color-mix percentage. */
function effectiveAlpha(rule: string): number {
  const opacity = rule.match(/opacity:\s*([\d.]+)/);
  const alpha = opacity ? Number(opacity[1]) : 1;
  const mix = rule.match(/color-mix\([^,]+,\s*[^,]+?\s+([\d.]+)%/);
  return mix ? alpha * (Number(mix[1]) / 100) : alpha;
}

function composite(fg: Rgb, bg: Rgb, alpha: number): string {
  const mix = (f: number, b: number) => Math.round(f * alpha + b * (1 - alpha));
  return `rgb(${mix(fg[0], bg[0])} ${mix(fg[1], bg[1])} ${mix(fg[2], bg[2])})`;
}

describe("panel resize handle grip dots", () => {
  it("paints the idle dots with a solid theme color, never a translucent mix", () => {
    // #14925: color-mix(..., 45%, transparent) plus opacity washed the dots
    // out to near-white on light backgrounds, so the drag icon was invisible
    // until hover. A solid token keeps them visible at rest.
    const rule = idleGripRule();
    expect(rule).not.toContain("color-mix");
    expect(rule).not.toContain("transparent");
    expect(rule).toMatch(/color:\s*var\(--muted-foreground\)/);
  });

  it.each([
    { dark: false, name: "light" },
    { dark: true, name: "dark" },
  ])("keeps the idle dots readable on the $name theme", ({ dark, name }) => {
    const rule = idleGripRule();
    const block = themeBlock(dark);
    const dots = composite(themeRgb(block, "--muted-foreground"), themeRgb(block, "--background"), effectiveAlpha(rule));
    const ratio = wcagContrastRatio(dots, `rgb(${themeRgb(block, "--background").join(" ")})`);
    expect(ratio, `idle grip dots vs ${dark ? "dark" : "light"} background (${dots})`).toBeGreaterThanOrEqual(3.5);
  });
});
