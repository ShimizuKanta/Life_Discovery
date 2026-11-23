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
  const header = card.locator('.card-topline');
  await header.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const box = await header.boundingBox();
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const end = { x: start.x + (direction === 'left' ? -90 : direction === 'right' ? 90 : 0), y: start.y + (direction === 'up' ? -90 : 0) };
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [end] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
  await expect.poll(() => page.locator('#app').evaluate(el => el.inert)).toBe(false);
}

test.beforeEach(async ({ page }) => { await page.goto('./'); await expect(page.locator('#content')).toBeVisible(); });

test('record subtitle and save button fit the initial mobile viewport', async ({ page }) => {
  const subtitle = page.locator('.new-page .page-heading p');
  const save = page.locator('#new-form button[type="submit"]');
  await expect(subtitle).toHaveText('初めてのこと。気づいたこと。人生の小さな発見を記録しましょう。');
  for (const viewport of [{ width: 320, height: 568 }, { width: 375, height: 667 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    expect(await subtitle.evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getClientRects().length;
    })).toBe(1);
    const box = await save.boundingBox();
    const card = await page.locator('.writing-card').boundingBox();
    expect(box.y).toBeGreaterThan(card.y + card.height + 12);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  }
  const saveBox = await save.boundingBox();
  expect((await page.locator('#new-form .photo-help').boundingBox()).y).toBeGreaterThanOrEqual(saveBox.y + saveBox.height);
});

test('record, persist, judge, review, flip, edit, archive restore and delete', async ({ page }) => {
  await add(page, '初めてパンを焼いた');
  await expect(page.locator('.celebration[data-action=saved] span').first()).toBeVisible();
  await page.reload();
  await go(page, 'weekly');
  await expect(page.locator('#discovery-card')).toContainText('初めてパンを焼いた');
  await page.locator('#keep').click();
  await expect(page.locator('.celebration[data-action=judged]')).toBeAttached();
  await expect(page.getByRole('heading', { name: '判定待ちの発見はありません' })).toBeVisible();
  await go(page, 'yearly');
  await page.locator('#score').fill('85');
  await page.locator('#score').dispatchEvent('input');
  await page.locator('#review-comment').fill('今では週末の楽しみ');
  await page.locator('#review-form button[type="submit"]').click();
  await expect(page.locator('.celebration[data-action=reviewed]')).toBeAttached();
  await expect(page.getByRole('heading', { name: '評価待ちの発見はありません' })).toBeVisible();
  await go(page, 'deck');
  await page.locator('#discovery-card').click();
  await expect(page.locator('#discovery-card')).toContainText('85%');
  await expect(page.locator('#discovery-card .saved-score')).toHaveValue('85');
  await expect(page.locator('#discovery-card .saved-score')).toBeDisabled();
  await expect(page.locator('#discovery-card')).toContainText('今では週末の楽しみ');
  await page.locator('#edit-card').click();
  await page.locator('#edit-content').fill('パン作りが好きになった');
  await expect(page.locator('#edit-score')).toHaveValue('85');
  await page.locator('#edit-score').press('End');
  await page.locator('#edit-review-comment').fill('今では毎週末焼いている');
  await page.locator('#edit-form .primary').click();
  await expect(page.locator('#editor')).not.toBeVisible();
  const data = await exportData(page);
  expect(data.discoveries[0].content).toBe('パン作りが好きになった');
  expect(data.discoveries[0].review).toMatchObject({ score: 100, comment: '今では毎週末焼いている' });
  await go(page, 'deck');
  await page.getByRole('button', { name: '長押しで編集' }).click();
  await expect(page.locator('#editor .photo-help')).toHaveCount(0);
  await page.locator('#edit-archive').click();
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
  expect(data.schemaVersion).toBe(2);
  await page.locator('#import-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion":99}') });
  await expect(page.locator('#error')).toContainText('形式が正しくない');
  await page.locator('#error button').click();
  expect((await exportData(page)).discoveries).toEqual(data.discoveries);
  await importData(page, { ...data, discoveries: [] }, false);
  expect((await exportData(page)).discoveries).toHaveLength(1);
  await go(page, 'deck');
  await expect(page.locator('#discovery-card')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#discovery-card .card-body img')).toHaveCount(0);
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
  await page.locator('#edit-form .primary').click();
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
  await page.locator('#edit-form .primary').click();
  await go(page, 'weekly');
  await expect(page.locator('#discovery-card')).toContainText('未来の発見');
  await page.locator('#keep').click();
  await go(page, 'yearly');
  await page.locator('#edit-card').click();
  await page.locator('#edit-date').fill('2099-01-01T12:00');
  await page.locator('#edit-form .primary').click();
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
  const header = page.locator('#discovery-card .card-topline');
  await header.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const box = await header.boundingBox();
  await page.mouse.move(box.x + 50, box.y + box.height / 2);
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
  await expect(page.locator('.celebration')).toHaveCount(0);
  await page.locator('#content').fill('保存に失敗しても入力を維持');
  await abortNextWrite();
  await page.locator('#new-form button[type="submit"]').click();
  await expect(page.locator('#error')).toContainText('保存できませんでした');
  await expect(page.locator('.celebration')).toHaveCount(0);
  await expect(page.locator('#content')).toHaveValue('保存に失敗しても入力を維持');
  await page.locator('#error button').click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#new-form button[type="submit"]').click();
  await expect(page.locator('#content')).toHaveValue('');
  await expect(page.locator('.celebration')).toHaveCount(0);
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
  await page.locator('#edit-form .primary').click();
  await expect(page.locator('#discovery-card')).toContainText('二つ目の発見');
  await expect(page.locator('#score')).toHaveValue('50');
  await expect(page.locator('#review-comment')).toHaveValue('');
});

test('cards follow small drags, spring back, flip in 3D and keep annual controls independent', async ({ page }) => {
  await add(page, '動くカード');
  await go(page, 'deck');
  const card = page.locator('#discovery-card');
  await card.scrollIntoViewIfNeeded();
  const box = await card.boundingBox();
  await page.mouse.move(box.x + 80, box.y + 90);
  await page.mouse.down();
  await page.mouse.move(box.x + 105, box.y + 90, { steps: 3 });
  await expect(card).toHaveClass(/dragging/);
  expect(await card.evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m41)).toBeCloseTo(25, 0);
  await page.mouse.up();
  await expect(card).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => card.evaluate(el => getComputedStyle(el).transform)).toBe('none');
  await card.click();
  await expect.poll(() => page.locator('#app').evaluate(el => el.inert)).toBe(true);
  await expect(page.locator('#discovery-card')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.locator('#app').evaluate(el => el.inert)).toBe(false);
  await go(page, 'weekly');
  await page.locator('#keep').click();
  await go(page, 'yearly');
  await expect(page.locator('#discovery-card #review-form')).toBeVisible();
  await page.locator('#review-comment').fill('入力を維持');
  await page.locator('#review-comment').press('Space');
  await page.locator('#score').fill('80');
  await page.locator('#score').dispatchEvent('input');
  await page.locator('#score').press('ArrowRight');
  await expect(page.locator('#score')).toHaveValue('81');
  await expect(card).not.toHaveClass(/flipped/);
  await page.locator('#discovery-card .card-topline').click();
  await expect(card).toHaveClass(/flipped/);
  await expect.poll(() => page.locator('#app').evaluate(el => el.inert)).toBe(false);
  await expect(page.locator('#score')).toHaveValue('81');
  await expect(page.locator('#review-comment')).toHaveValue('入力を維持 ');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#discovery-card .card-topline').click();
  await expect(card).not.toHaveClass(/flipped/);
  await expect(page.locator('#score')).toHaveValue('81');
  await page.screenshot({ path: 'test-results/annual-card.png', fullPage: true });
});

test('v2 photos, category filters, random cards, calendar and offline backup round trip', async ({ page, context }) => {
  await page.clock.install({ time: new Date('2026-11-19T03:00:00Z') });
  await page.reload();
  await page.locator('#new-category [data-category="first"]').click();
  await page.locator('#new-photo').setInputFiles('public/icons/icon-192.png');
  await expect(page.locator('#new-preview img')).toBeVisible();
  await add(page, '写真付きの初体験', '2026-11-18T12:00');
  await page.locator('#new-category [data-category="insight"]').click();
  await add(page, '同じ日の気づき', '2026-11-18T15:00');
  await add(page, '今日の発見', '2026-11-19T12:00');
  await go(page, 'deck');
  await expect(page.locator('#filter-category [aria-pressed="true"]')).toHaveCount(5);
  await expect(page.locator('#filter-category [data-category="all"]')).toHaveCount(0);
  await page.locator('#filter-category [data-category="other"]').click();
  await expect(page.locator('.deck-position')).toHaveText('1 / 2');
  await page.locator('#filter-category [data-category="insight"]').click();
  await expect(page.locator('#discovery-card')).toContainText('写真付きの初体験');
  await expect(page.locator('#discovery-card .discovery-photo')).toBeVisible();
  await expect(page.locator('.deck-position')).toHaveText('1 / 1');
  await page.locator('#random-card').click();
  await expect(page.locator('.deck-position')).toHaveText('1 / 1');
  await page.locator('#filter-category [data-category="insight"]').click();
  await page.locator('#filter-category [data-category="other"]').click();
  const original = await page.locator('#discovery-card .card-content').textContent();
  await page.locator('#random-card').click();
  await expect(page.locator('#discovery-card .card-content')).not.toHaveText(original);
  await go(page, 'calendar');
  await page.getByRole('button', { name: '2026年11月' }).click();
  await page.locator('#calendar-year').fill('2024');
  await page.locator('#calendar-month').selectOption('1');
  await page.locator('#month-picker-form button[type="submit"]').click();
  await expect(page.getByRole('button', { name: '2024年2月' })).toBeFocused();
  await expect(page.locator('[data-day="2024-02-29"]')).toBeVisible();
  await page.getByRole('button', { name: '2024年2月' }).click();
  await page.locator('#calendar-year').fill('2026');
  await page.locator('#calendar-month').selectOption('10');
  await page.locator('#calendar-year').press('Enter');
  await page.locator('[data-day="2026-11-18"]').click();
  await expect(page.locator('.calendar-entry')).toHaveCount(2);
  await expect(page.locator('[data-day="2026-11-18"] .category-mark')).toHaveCount(2);
  await page.locator('.calendar-entry .discovery-card').first().click();
  await expect(page.locator('.calendar-entry .discovery-card').first()).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#previous-month').click();
  await expect(page.locator('[data-day="2026-10-01"]')).toBeVisible();
  await page.locator('#next-month').click();
  await page.locator('[data-day="2026-11-18"]').click();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await context.setOffline(true);
  const backup = await exportData(page);
  expect(backup.schemaVersion).toBe(2);
  expect(backup.discoveries.find(item => item.content === '写真付きの初体験').photo).toMatch(/^data:image\/jpeg;base64,/);
  await go(page, 'calendar');
  await page.locator('[data-calendar-edit]').first().click();
  await page.locator('#edit-remove-photo').click();
  await page.locator('#edit-category [data-category="achievement"]').click();
  await page.locator('#edit-form .primary').click();
  expect((await exportData(page)).discoveries.find(item => item.content === '写真付きの初体験').photo).toBeNull();
  await importData(page, backup);
  await page.reload();
  await go(page, 'deck');
  await page.locator('#filter-category [data-category="other"]').click();
  await page.locator('#filter-category [data-category="insight"]').click();
  await expect(page.locator('#discovery-card .discovery-photo')).toBeVisible();
  await page.screenshot({ path: 'test-results/version2-photo.png', fullPage: true });
});

test('v1 backups upgrade without losing answers and invalid v2 photos do not replace data', async ({ page }) => {
  await add(page, '第1版の発見');
  const data = await exportData(page);
  const legacy = { ...data, schemaVersion: 1, discoveries: data.discoveries.map(({ category: _category, photo: _photo, ...item }) => item) };
  await importData(page, legacy);
  const upgraded = await exportData(page);
  expect(upgraded.discoveries[0]).toEqual({ ...legacy.discoveries[0], category: 'other', photo: null });
  await page.locator('#import-file').setInputFiles({ name: 'bad-photo.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...upgraded, discoveries: [{ ...upgraded.discoveries[0], photo: 'data:image/jpeg;base64,/9j/AAAA' }] })) });
  await expect(page.locator('#error')).toContainText('形式が正しくない');
  await page.locator('#error button').click();
  expect((await exportData(page)).discoveries).toEqual(upgraded.discoveries);
});

test('five horizontal category buttons and camera attachment work in new and edit forms', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const buttons = page.locator('#new-category .category-buttons button');
  await expect(buttons).toHaveCount(5);
  await expect.poll(() => buttons.locator('img').evaluateAll(images => images.filter(image => image.naturalWidth > 0).length)).toBe(5);
  const rows = await buttons.evaluateAll(elements => elements.map(el => Math.round(el.getBoundingClientRect().top)));
  expect(new Set(rows).size).toBe(1);
  await buttons.nth(2).click();
  await expect(buttons.nth(2)).toHaveAttribute('aria-pressed', 'true');
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#new-take-photo').click();
  const chooser = await chooserPromise;
  expect(await chooser.element().getAttribute('capture')).toBe('environment');
  await chooser.setFiles('public/icons/icon-192.png');
  await expect(page.locator('#new-preview img')).toBeVisible();
  await expect(page.locator('.record-button')).toBeInViewport({ ratio: 1 });
  const card = await page.locator('.writing-card').boundingBox();
  expect((await page.locator('.record-button').boundingBox()).y).toBeGreaterThan(card.y + card.height + 12);
  await add(page, 'カメラからの写真');
  await go(page, 'deck');
  await expect(page.locator('#discovery-card')).toContainText('感動');
  await page.locator('#edit-card').click();
  await expect(page.locator('#edit-category [data-category="emotion"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#edit-camera')).toHaveAttribute('capture', 'environment');
  await page.locator('#edit-category [data-category="achievement"]').click();
  await page.locator('#edit-form .primary').click();
  await expect(page.locator('#discovery-card')).toContainText('達成');
});

test('card size stays fixed across photos and faces, and long text remains scrollable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.locator('#new-photo').setInputFiles('public/icons/icon-192.png');
  await expect(page.locator('#new-preview img')).toBeVisible();
  await add(page, '短い発見', '2020-01-01T12:00');
  await add(page, '長い発見を最後まで読めるようにする。'.repeat(80), '2020-01-02T12:00');
  await go(page, 'deck');
  const card = page.locator('#discovery-card');
  const body = card.locator('.card-body');
  const longSize = await card.locator('.card-content').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  const height = (await card.boundingBox()).height;
  expect(height).toBeGreaterThan((await card.boundingBox()).width);
  await card.focus();
  await page.keyboard.press('ArrowDown');
  expect(await body.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await page.locator('#next').click();
  await expect(card.locator('.discovery-photo')).toBeVisible();
  expect((await card.boundingBox()).height).toBe(height);
  expect(await card.locator('.card-content').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThan(longSize);
  const frontColor = await card.evaluate(el => getComputedStyle(el).backgroundImage);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await card.locator('.card-topline').click();
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  expect((await card.boundingBox()).height).toBe(height);
  expect(await card.evaluate(el => getComputedStyle(el).backgroundImage)).not.toBe(frontColor);
});
