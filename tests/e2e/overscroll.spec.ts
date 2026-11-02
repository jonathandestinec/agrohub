import { expect, test } from "@playwright/test";

// Scrolling past the end of a page lifts the frame to reveal the logo, then springs back.
test("overscrolling at the bottom of a page reveals the logo and springs back", async ({ page }) => {
  await page.goto("/privacy");
  const frame = page.locator("[data-overscroll-frame]");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.mouse.move(400, 300);

  // The lift lasts only while the wheel keeps going, so record its peak in the page.
  await page.evaluate(() => {
    const w = window as unknown as { peak: { lift: number; logo: number } };
    w.peak = { lift: 0, logo: 0 };
    const f = document.querySelector("[data-overscroll-frame]")!;
    const l = document.querySelector("[data-overscroll-logo]")!;
    const tick = () => {
      w.peak.lift = Math.max(w.peak.lift, -new DOMMatrix(getComputedStyle(f).transform).m42);
      w.peak.logo = Math.max(w.peak.logo, Number(getComputedStyle(l).opacity));
      requestAnimationFrame(tick);
    };
    tick();
  });
  const peak = () => page.evaluate(() => (window as unknown as { peak: { lift: number; logo: number } }).peak);
  // Wheel again on each try: the listener only exists once the page has hydrated.
  await expect
    .poll(async () => {
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(100);
      return (await peak()).lift;
    })
    .toBeGreaterThan(20);
  expect((await peak()).logo).toBeGreaterThan(0.2);

  // Released: back to rest.
  await expect
    .poll(() => frame.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m42), { timeout: 3000 })
    .toBe(0);
});

test("ordinary scrolling above the bottom does not lift the frame", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 500 });
  await page.goto("/sign-up");
  await page.waitForLoadState("networkidle");
  await page.mouse.move(200, 200);
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(50);
  const shift = await page
    .locator("[data-overscroll-frame]")
    .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m42);
  expect(shift).toBe(0);
});
