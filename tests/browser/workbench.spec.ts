import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("boots the built app, renders Pixi, pauses and replays a developer command", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("#plan canvas")).toBeVisible();
  await expect(page.getByTestId("tick")).toHaveText("0");
  await expect(page.getByRole("button", { name: "Закрыть", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Запустить", exact: true }).click();
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(page.locator("#door-status")).toContainText("Положение: закрыта");
  await expect.poll(async () => Number(await page.getByTestId("tick").textContent())).toBeGreaterThanOrEqual(1);
  await page.getByRole("button", { name: "Пауза", exact: true }).click();
  const tick = await page.getByTestId("tick").textContent();
  await page.waitForTimeout(1100);
  await expect(page.getByTestId("tick")).toHaveText(tick!);
  await page.getByRole("button", { name: "Проверить журнал →" }).click();
  await expect(page.getByRole("status")).toContainText("Повтор совпал");
  expect(errors).toEqual([]);
  await page.screenshot({ path: "test-results/workbench.png", fullPage: true });
});

test("IndexedDB survives a reload; JSON round trip preserves a pending action", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("SEED ЭКСПЕДИЦИИ").fill("browser-save");
  await page.getByRole("button", { name: "Создать", exact: true }).click();
  await page.getByRole("button", { name: "Запустить", exact: true }).click();
  await page.getByRole("button", { name: "Осмотр · 5 с" }).click();
  await page.getByRole("button", { name: "Пауза", exact: true }).click();
  await expect(page.getByTestId("action")).toContainText("осталось");
  const action = await page.getByTestId("action").textContent();
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Сохранено локально");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Экспорт JSON ↗" }).click();
  const download = await downloadPromise;
  const bytes = await readFile((await download.path())!);
  const snapshot = JSON.parse(bytes.toString());
  expect(snapshot.world.seed).toBe("browser-save");
  expect(snapshot.world.balanceVersion).toBe("1.1");
  await page.reload();
  await page.getByRole("button", { name: "Загрузить", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Снимок загружен");
  await expect(page.getByLabel("SEED ЭКСПЕДИЦИИ")).toHaveValue("browser-save");
  await expect(page.getByTestId("action")).toHaveText(action!);
  await page.locator("#import").setInputFiles({ name: "checkpoint.json", mimeType: "application/json", buffer: bytes });
  await expect(page.getByTestId("tick")).toHaveText(String(snapshot.world.tick));
  await expect(page.getByTestId("action")).toHaveText(action!);
});

test("unsupported JSON import leaves the current world unchanged", async ({ page }) => {
  await page.goto("/");
  const before = await page.locator("#state-hash").textContent();
  await page.locator("#import").setInputFiles({ name: "wrong.json", mimeType: "application/json", buffer: Buffer.from('{"schemaVersion":999}') });
  await expect(page.getByRole("status")).toContainText("Снимок не загружен");
  await expect(page.locator("#state-hash")).toHaveText(before!);
});
