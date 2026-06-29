import { test, expect } from "@playwright/test";

test("board route renders the shell nav and empty state", async ({ page }) => {
  await page.goto("/board");

  await expect(page.getByRole("link", { name: "Board" })).toBeVisible();
  await expect(page.getByRole("link", { name: "My Tasks" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Calendar" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Chat" })).toBeVisible();

  await expect(page.getByText(/no boards yet/i)).toBeVisible();
});

test("home redirects to the board", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/board$/);
});
