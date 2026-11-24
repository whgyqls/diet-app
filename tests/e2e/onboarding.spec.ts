import { expect, test } from './fixtures';
import { waitForSaved } from './helpers/saved';

test('onboarding shows day targets and keeps input after reload', async ({
  page,
}) => {
  await page.goto('/onboarding');
  await page.getByRole('button', { name: '여성' }).click();
  await page.getByPlaceholder('1995').fill('1995');
  await page.getByPlaceholder('170').fill('165');
  await page.getByPlaceholder('65').fill('60');
  await page.getByRole('button', { name: /3단계/ }).click();
  await page.getByRole('button', { name: '감량' }).click();
  await page.getByRole('button', { name: '3끼' }).click();
  await expect(page.getByText('하루 목표')).toBeVisible();
  await expect(page.getByText(/kcal/)).toBeVisible();
  await page.getByRole('button', { name: /저탄수/ }).click();
  await waitForSaved(page); // edits go to the server a moment after they are made
  await page.reload();
  await expect(page.getByRole('button', { name: /저탄수/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
