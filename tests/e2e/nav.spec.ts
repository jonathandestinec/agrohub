import { expect, test } from "@playwright/test";

// The pinned nav from the demo: it narrows while scrolling down and returns on scrolling up.
test("the nav narrows on scroll down and comes back on scroll up", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const bar = page.locator(".nav-bar");
  await expect(bar).not.toHaveAttribute("data-compact", /.*/);

  await page.mouse.move(400, 400);
  await expect
    .poll(async () => {
      await page.mouse.wheel(0, 400);
      return bar.getAttribute("data-compact");
    })
    .not.toBeNull();
  await expect(bar).toHaveAttribute("data-scrolled", "");

  await page.mouse.wheel(0, -300);
  await expect(bar).not.toHaveAttribute("data-compact", /.*/);
  // Still pinned: the bar stays at the top of the screen.
  expect((await bar.boundingBox())!.y).toBeLessThan(40);
});
