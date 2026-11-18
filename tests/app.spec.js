import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function go(page, target) {
  await page.locator('#menu').click();
  await page.locator(`#drawer [data-page="${target}"]`).click();
}
async function add(page, content, date = '2020-01-01T12:30') {
  await page.locator('#content').fill(content);
  await page.locator('#discovered-at').fill(date);
  await page.locator('#new-form button[type="submit"]').click();
  await expect(page.locator('#content')).toHaveValue('');
}
async function exportData(page) {
  await go(page, 'settings');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export').click();
  const download = await downloadPromise;
  return JSON.parse(await readFile(await download.path(), 'utf8'));
}
async function importData(page, data, accept = true) {
  await go(page, 'settings');
  page.once('dialog', dialog => accept ? dialog.accept() : dialog.dismiss());
  await page.locator('#import-file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await expect(page.locator('#app')).toHaveAttribute('aria-busy', 'false');
}
async function gesture(page, direction) {
  const card = page.locator('#discovery-card');
  await card.scrollIntoViewIfNeeded();
  const box = await card.boundingBox();
  const start = { x: box.x + box.width / 2, y: box.y + 130 };
  const end = { x: start.x + (direction === 'left' ? -90 : direction === 'right' ? 90 : 0), y: start.y + (direction === 'up' ? -90 : 0) };
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [end] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
}

test.beforeEach(async ({ page }) => { await page.goto('./'); await expect(page.locator('#content')).toBeVisible(); });

test('record, persist, judge, review, flip, edit, archive restore and delete', async ({ page }) => {
  await add(page, '初めてパンを焼いた');
  await page.reload();
  await go(page, 'weekly');
  await expect(page.locator('#discovery-card')).toContainText('初めてパンを焼いた');
  await page.locator('#keep').click();
  await expect(page.getByRole('heading', { name: '判定待ちの発見はありません' })).toBeVisible();
  await go(page, 'yearly');
  await page.locator('#score').fill('85');
  await page.locator('#score').dispatchEvent('input');
  await page.locator('#review-comment').fill('今では週末の楽しみ');
  await page.locator('#review-form button[type="submit"]').click();
  await expect(page.getByRole('heading', { name: '評価待ちの発見はありません' })).toBeVisible();
  await go(page, 'deck');
  await page.locator('#discovery-card').click();
  await expect(page.locator('#discovery-card')).toContainText('85%');
  await expect(page.locator('#discovery-card')).toContainText('今では週末の楽しみ');
  await page.locator('#edit-card').click();
  await page.locator('#edit-content').fill('パン作りが好きになった');
  await page.locator('#edit-form button[type="submit"]').click();
  await expect(page.locator('#editor')).not.toBeVisible();
  const data = await exportData(page);
  expect(data.discoveries[0].content).toBe('パン作りが好きになった');
  expect(data.discoveries[0].review.score).toBe(85);
  data.discoveries[0].decision = 'archived';
  await importData(page, data);
  await go(page, 'deck');
  await expect(page.locator('#discovery-card')).toHaveCount(0);
  await page.locator('#include-archived').check();
  await expect(page.locator('#discovery-card')).toHaveClass(/archived/);
  await page.locator('#edit-card').click();
  await page.locator('#restore').click();
  await expect(page.locator('#discovery-card')).not.toHaveClass(/archived/);
  await page.locator('#edit-card').click();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#delete').click();
  await expect(page.locator('#discovery-card')).toHaveCount(0);
  expect((await exportData(page)).discoveries).toHaveLength(0);
});

test('touch swipes judge, skip without losing records, and navigate cards', async ({ page }) => {
  await add(page, '最初の発見', '2020-01-01T12:00');
  await add(page, '次の発見', '2020-01-02T12:00');
  await go(page, 'weekly');
  await gesture(page, 'up');
  await expect(page.locator('#discovery-card')).toContainText('次の発見');
  await gesture(page, 'left');
  await expect(page.locator('#discovery-card')).toContainText('最初の発見');
  await gesture(page, 'right');
  await expect(page.locator('#discovery-card')).toHaveCount(0);
  await go(page, 'yearly');
  await gesture(page, 'left');
  await expect(page.locator('#discovery-card')).toContainText('最初の発見');
  await page.locator('#review-comment').fill('スワイプで保存');
  await gesture(page, 'right');
  await expect(page.locator('#discovery-card')).toHaveCount(0);
  await go(page, 'deck');
  await page.locator('#include-archived').check();
  await expect(page.locator('#discovery-card')).toContainText('次の発見');
  await gesture(page, 'left');
  await expect(page.locator('#discovery-card')).toContainText('最初の発見');
  await gesture(page, 'right');
  await expect(page.locator('#discovery-card')).toContainText('次の発見');
});

test('backup validation and cancellation preserve data, valid restore replaces settings and records', async ({ page }) => {
  await add(page, '<img src=x onerror=alert(1)>');
  const data = await exportData(page);
  expect(data.schemaVersion).toBe(1);
  await page.locator('#import-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion":99}') });
  await expect(page.locator('#error')).toContainText('形式が正しくない');
  await page.locator('#error button').click();
  expect((await exportData(page)).discoveries).toEqual(data.discoveries);
  await importData(page, { ...data, discoveries: [] }, false);
  expect((await exportData(page)).discoveries).toHaveLength(1);
  await go(page, 'deck');
  await expect(page.locator('#discovery-card')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#discovery-card img')).toHaveCount(0);
  await importData(page, { ...data, discoveries: [], settings: { language: 'en' } });
  await expect(page.locator('#language')).toHaveValue('en');
  await page.reload();
  await expect(page.locator('#content')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  expect((await exportData(page)).discoveries).toHaveLength(0);
});

test('all primary operations work offline under a GitHub Pages project path', async ({ page, context }) => {
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#content')).toBeVisible();
  await add(page, 'オフラインで発見');
  await go(page, 'weekly');
  await page.locator('#keep').click();
  await go(page, 'yearly');
  await page.locator('#review-comment').fill('オフラインで振り返り');
  await page.locator('#review-form button[type="submit"]').click();
  await go(page, 'deck');
  await page.locator('#edit-card').click();
  await page.locator('#edit-content').fill('オフラインで編集');
  await page.locator('#edit-form button[type="submit"]').click();
  const data = await exportData(page);
  expect(data.discoveries[0].content).toBe('オフラインで編集');
  expect(data.discoveries[0].review.comment).toBe('オフラインで振り返り');
  await importData(page, data);
  await page.reload();
  await expect(page.locator('#content')).toBeVisible();
  await go(page, 'deck');
  await expect(page.locator('#discovery-card')).toContainText('オフラインで編集');
});

test('future dates, edits, filters and pending badges follow discovery dates', async ({ page }) => {
  await add(page, '未来の発見', '2099-01-01T12:00');
  await go(page, 'weekly');
  await expect(page.locator('#discovery-card')).toHaveCount(0);
  await go(page, 'deck');
  await page.locator('#edit-card').click();
  await page.locator('#edit-date').fill('2020-01-01T12:00');
  await page.locator('#edit-form button[type="submit"]').click();
  await go(page, 'weekly');
  await expect(page.locator('#discovery-card')).toContainText('未来の発見');
  await page.locator('#keep').click();
  await go(page, 'yearly');
  await page.locator('#edit-card').click();
  await page.locator('#edit-date').fill('2099-01-01T12:00');
  await page.locator('#edit-form button[type="submit"]').click();
  await expect(page.locator('#discovery-card')).toHaveCount(0);
  await go(page, 'new');
  await add(page, '昨日の発見', '2025-01-02T23:59');
  await go(page, 'deck');
  await expect(page.locator('#discovery-card')).toContainText('未来の発見');
  await page.locator('#sort').selectOption('oldest');
  await expect(page.locator('#discovery-card')).toContainText('昨日の発見');
  await page.locator('summary').click();
  await page.locator('#from').fill('2025-01-02');
  await page.locator('#to').fill('2025-01-02');
  await expect(page.locator('.deck-position')).toHaveText('1 / 1');
});

test('menu edge gesture, long press, keyboard and narrow viewport remain usable', async ({ page }) => {
  await add(page, '長押しで編集');
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 5, y: 130 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 130, y: 130 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('#drawer')).toBeVisible();
  await page.locator('#drawer [data-page="deck"]').click();
  const box = await page.locator('#discovery-card').boundingBox();
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await expect(page.locator('#editor')).toBeVisible();
  await page.mouse.up();
  await page.keyboard.press('Escape');
  await expect(page.locator('#editor')).not.toBeVisible();
  await page.locator('#discovery-card').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#discovery-card')).toContainText('未判定');
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/deck-mobile.png', fullPage: true });
  await go(page, 'new');
  await page.screenshot({ path: 'test-results/new-mobile.png', fullPage: true });
  await session.detach();
});

test('storage failures keep drafts and roll back a whole backup replacement', async ({ page }) => {
  await add(page, '失ってはいけない記録');
  const original = await exportData(page);
  async function abortNextWrite() {
    await page.evaluate(() => {
      const transaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (...args) {
        const tx = transaction.apply(this, args);
        if (args[1] === 'readwrite') {
          IDBDatabase.prototype.transaction = transaction;
          queueMicrotask(() => tx.abort());
        }
        return tx;
      };
    });
  }
  await abortNextWrite();
  await importData(page, { ...original, discoveries: [] });
  await expect(page.locator('#error')).toContainText('保存できませんでした');
  await page.locator('#error button').click();
  expect((await exportData(page)).discoveries).toEqual(original.discoveries);
  await go(page, 'new');
  await page.locator('#content').fill('保存に失敗しても入力を維持');
  await abortNextWrite();
  await page.locator('#new-form button[type="submit"]').click();
  await expect(page.locator('#error')).toContainText('保存できませんでした');
  await expect(page.locator('#content')).toHaveValue('保存に失敗しても入力を維持');
  await page.locator('#error button').click();
  await page.locator('#new-form button[type="submit"]').click();
  await expect(page.locator('#content')).toHaveValue('');
  expect((await exportData(page)).discoveries).toHaveLength(2);
});

test('elapsed time refreshes pending counts and visible queues without reopening the app', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-18T03:00:00Z') });
  await page.reload();
  await expect(page.locator('#content')).toBeVisible();
  await add(page, '7日になる直前', '2026-11-11T12:01');
  await go(page, 'weekly');
  await expect(page.locator('#discovery-card')).toHaveCount(0);
  await page.clock.runFor(61000);
  await expect(page.locator('#discovery-card')).toContainText('7日になる直前');
  await page.locator('#menu').click();
  await expect(page.locator('[data-count="weekly"]')).toHaveText('1');
});

test('editing a discovery out of the annual queue does not move its unfinished answer to another card', async ({ page }) => {
  await add(page, '一つ目の発見', '2020-01-01T12:00');
  await add(page, '二つ目の発見', '2021-01-01T12:00');
  await go(page, 'weekly');
  await page.locator('#keep').click();
  await expect(page.locator('#discovery-card')).toContainText('二つ目の発見');
  await page.locator('#keep').click();
  await go(page, 'yearly');
  await expect(page.locator('#discovery-card')).toHaveAccessibleName(/一つ目の発見/);
  await page.locator('#score').fill('90');
  await page.locator('#score').dispatchEvent('input');
  await page.locator('#review-comment').fill('一つ目だけの回答');
  await page.locator('#edit-card').click();
  await page.locator('#edit-date').fill('2099-01-01T12:00');
  await page.locator('#edit-form button[type="submit"]').click();
  await expect(page.locator('#discovery-card')).toContainText('二つ目の発見');
  await expect(page.locator('#score')).toHaveValue('50');
  await expect(page.locator('#review-comment')).toHaveValue('');
});
