import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { offline } from './support';

/**
 * The venue editor with the desktop shell stood in for: the real settings file is
 * served for reading, saves are captured instead of written, and the YouTube feed is a
 * fixed one. The real file is never modified.
 */
const settingsPath = new URL('../../backend/TaikoLabs.Api/venues.json', import.meta.url);
const original = readFileSync(settingsPath, 'utf8');

const feed = (titles: string[]) => `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom"><author><name>테스트 채널</name></author>
${titles.map((title) => `<entry><title>${title}</title></entry>`).join('')}</feed>`;

async function openEditor(page: Page) {
  const saved: string[] = [];
  await page.exposeFunction('__shell', (command: string, args: Record<string, string>) => {
    if (command === 'editor_open') return { path: '/test/venues.json', text: original };
    if (command === 'editor_save') return void saved.push(args.text);
    if (command === 'editor_fetch') return feed(['태고-1 2026-09-25', '태고-2 2026-09-24', '공지 방송']);
    return null;
  });
  await page.addInitScript(() => {
    const shell = (window as unknown as { __shell: (c: string, a?: unknown) => Promise<unknown> }).__shell;
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: (command: string, args?: unknown) => shell(command, args),
    };
  });
  await page.goto('/?screen=editor');
  await expect(page.locator('.editor__status')).toContainText('매장을 불러왔습니다');
  return saved;
}

const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );

test.skip(({ isMobile }) => isMobile, 'the editor is a desktop screen');

test.beforeEach(async ({ page }) => {
  await offline(page);
});

test('saving without edits writes back the same settings', async ({ page }) => {
  const saved = await openEditor(page);
  await expect(page).toHaveTitle('매장 등록기 · 태고 멀티뷰');

  await page.getByRole('button', { name: /^저장/ }).click();
  await expect(page.locator('.editor__status')).toContainText('저장 완료');

  expect(saved).toHaveLength(1);
  expect(canonical(JSON.parse(saved[0]))).toBe(canonical(JSON.parse(original)));
});

test('an edit is saved and nothing else moves', async ({ page }) => {
  const saved = await openEditor(page);
  await page.getByRole('option', { name: '부천 P2존' }).click();
  await page.getByLabel('이름', { exact: true }).fill('부천 P2존 (수정)');
  await page.getByRole('button', { name: /^저장/ }).click();
  await expect(page.locator('.editor__status')).toContainText('저장 완료');

  const expected = JSON.parse(original);
  expected.Venues.Items.find((venue: { id: string }) => venue.id === 'p2zone').name = '부천 P2존 (수정)';
  expect(canonical(JSON.parse(saved[0]))).toBe(canonical(expected));
});

test('fetched titles are matched, and do not follow to another venue', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('option', { name: '부천 P2존' }).click();
  await page.getByRole('tab', { name: '제목 규칙' }).click();
  await page.getByRole('button', { name: '채널에서 제목 가져오기' }).click();

  const rows = page.locator('.table tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('taiko-1 (태고-1)');
  await expect(rows.nth(2)).toContainText('매칭 안 됨');

  // The bug: switching venues kept the previous venue's titles on screen.
  await page.getByRole('option', { name: '싸이뮤직 게임월드' }).click();
  await expect(page.getByRole('tab', { name: '제목 규칙' })).toHaveAttribute('aria-selected', 'true');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('아직 가져온 제목이 없습니다');
});

test('a venue that would not load blocks the save', async ({ page }) => {
  const saved = await openEditor(page);
  await page.getByLabel('channelId').fill('');
  await page.getByRole('button', { name: /^저장/ }).click();

  await expect(page.locator('.editor__status')).toContainText('저장하지 못했습니다');
  await expect(page.getByRole('tab', { name: /검증/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.check__error')).toContainText('channelId');
  expect(saved).toHaveLength(0);
});
