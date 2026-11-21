import { expect, test } from '@playwright/test';

test('food card cycles ok -> favorite -> none and survives reload', async ({
  page,
}) => {
  await page.goto('/select');
  const card = page.getByRole('button', { name: /^닭가슴살, / });
  await card.click();
  await expect(card).toHaveAttribute('aria-label', '닭가슴살, 먹을 수 있음');
  await card.click();
  await expect(card).toHaveAttribute('aria-label', '닭가슴살, 좋아함');
  await page.reload();
  await expect(
    page.getByRole('button', { name: '닭가슴살, 좋아함' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '닭가슴살, 좋아함' }).click();
  await expect(
    page.getByRole('button', { name: '닭가슴살, 선택 안 함' }),
  ).toBeVisible();
});

test('info sheet opens and the minimum condition notice shows', async ({
  page,
}) => {
  await page.goto('/select');
  await expect(page.getByRole('status')).toContainText('단백질');
  await page.getByRole('button', { name: '닭가슴살 영양성분 보기' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('pescatarian dims meat cards', async ({ page }) => {
  await page.goto('/onboarding');
  await page.getByRole('button', { name: /페스코/ }).click();
  await page.goto('/select');
  await expect(
    page.getByText('이 스타일에서는 추천에서 제외돼요').first(),
  ).toBeVisible();
});

const step = (page: import('@playwright/test').Page, label: string) =>
  page.getByRole('navigation', { name: '진행 단계' }).getByRole('button', {
    name: new RegExp(label),
  });

test('oils live in the fat step behind the "기름" filter, not in seasonings', async ({
  page,
}) => {
  await page.goto('/select');
  await step(page, '지방원').click();
  await page.getByRole('button', { name: '기름', exact: true }).click();
  const oils = page.getByRole('button', {
    name: /^(엑스트라버진 올리브유|들기름|참기름), /,
  });
  await expect(oils).toHaveCount(3);
  await expect(page.getByText('조리에도 쓸 수 있어요')).toHaveCount(3);
  await expect(page.getByRole('button', { name: /^아몬드, / })).toHaveCount(0);
  await page.getByRole('button', { name: '견과·씨앗·아보카도' }).click();
  await expect(page.getByRole('button', { name: /^아몬드, / })).toBeVisible();
  await expect(oils).toHaveCount(0);
  await step(page, '양념').click();
  await expect(page.getByRole('button', { name: /^소금, / })).toBeVisible();
  await expect(
    page.getByRole('button', { name: /올리브유|들기름|참기름/ }),
  ).toHaveCount(0);
});

test('reset all asks first, clears every step and can be undone', async ({
  page,
}) => {
  await page.goto('/select');
  await page.getByRole('button', { name: '닭가슴살, 선택 안 함' }).click();
  await step(page, '양념').click();
  await page.getByRole('button', { name: '소금, 선택 안 함' }).click();

  await page.getByRole('button', { name: '전체 초기화' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('고른 재료를 모두 지울까요?');
  await dialog.getByRole('button', { name: '취소' }).click();
  await expect(
    page.getByRole('button', { name: /^소금, 먹을 수 있음/ }),
  ).toBeVisible();

  await page.getByRole('button', { name: '전체 초기화' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: '초기화' })
    .click();
  await expect(
    page.getByRole('button', { name: '소금, 선택 안 함' }),
  ).toBeVisible();
  await expect(step(page, '단백질')).toContainText('0개');

  await page.getByRole('button', { name: '되돌리기' }).click();
  await expect(
    page.getByRole('button', { name: '소금, 먹을 수 있음' }),
  ).toBeVisible();
  await expect(step(page, '단백질')).toContainText('1개');
});

test('reset step clears only the current step', async ({ page }) => {
  await page.goto('/select');
  await page.getByRole('button', { name: '닭가슴살, 선택 안 함' }).click();
  await step(page, '식이섬유').click();
  await page.getByRole('button', { name: /^양배추, 선택 안 함/ }).click();
  await expect(step(page, '식이섬유')).toContainText('1개');
  await page.getByRole('button', { name: '이 단계 초기화' }).click();
  await expect(step(page, '식이섬유')).toContainText('0개');
  await expect(step(page, '단백질')).toContainText('1개');
  await expect(
    page.getByRole('button', { name: '이 단계 초기화' }),
  ).toBeDisabled();
});

test('ingredient kits: save, reset, load (replace / merge), rename, delete, survive reload', async ({
  page,
}) => {
  await page.goto('/select');
  await page.getByRole('button', { name: '닭가슴살, 선택 안 함' }).click();

  await page.getByRole('button', { name: '내 재료 세트' }).click();
  const sheet = page.getByRole('dialog', { name: '내 재료 세트' });
  await sheet.getByLabel('세트 이름').fill('평일 점심');
  await sheet.getByLabel('식단 스타일도 함께 저장').check();
  await sheet.getByRole('button', { name: '현재 선택 저장' }).click();
  await expect(sheet.getByText('평일 점심')).toBeVisible();
  await sheet.getByRole('button', { name: '닫기' }).click();

  // Change the selection: drop chicken, pick cod.
  await page.getByRole('button', { name: '닭가슴살, 먹을 수 있음' }).click();
  await page.getByRole('button', { name: '닭가슴살, 좋아함' }).click();
  await page.getByRole('button', { name: /^대구, 선택 안 함/ }).click();

  await page.reload();
  await page.getByRole('button', { name: '내 재료 세트' }).click();
  await sheet.getByRole('button', { name: '평일 점심 불러오기' }).click();
  await sheet.getByRole('button', { name: '합치기' }).click();
  await expect(
    page.getByRole('button', { name: '닭가슴살, 먹을 수 있음' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /^대구, 먹을 수 있음/ }),
  ).toBeVisible();

  await page.getByRole('button', { name: '내 재료 세트' }).click();
  await sheet.getByRole('button', { name: '평일 점심 불러오기' }).click();
  await sheet.getByRole('button', { name: '바꾸기' }).click();
  await expect(
    page.getByRole('button', { name: /^대구, 선택 안 함/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '닭가슴살, 먹을 수 있음' }),
  ).toBeVisible();

  await page.getByRole('button', { name: '내 재료 세트' }).click();
  await sheet.getByRole('button', { name: '평일 점심 이름 수정' }).click();
  await sheet.getByLabel('새 이름').fill('주중');
  await sheet.getByRole('button', { name: '이름 저장' }).click();
  await expect(sheet.getByText('주중')).toBeVisible();

  await sheet.getByRole('button', { name: '주중 삭제' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: '삭제' })
    .click();
  await expect(sheet.getByText('저장한 세트가 없어요')).toBeVisible();
});

test('re-entering /select starts at the protein step with earlier choices still selected', async ({
  page,
}) => {
  await page.goto('/select');
  await page.getByRole('button', { name: /^닭가슴살, / }).click();
  await step(page, '양념').click();
  await expect(step(page, '양념')).toHaveAttribute('aria-current', 'step');

  // leave and come back (the saved step used to bring back 양념)
  await page.goto('/');
  await page.goto('/select');
  await expect(step(page, '단백질')).toHaveAttribute('aria-current', 'step');
  await expect(
    page.getByRole('button', { name: '닭가슴살, 먹을 수 있음' }),
  ).toBeVisible();
  await page.reload();
  await expect(step(page, '단백질')).toHaveAttribute('aria-current', 'step');
});
