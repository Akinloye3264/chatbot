import { expect, test } from '@playwright/test';

test('generated images display, persist, and restore the prompt on quota errors', async ({ page }) => {
  let failing = false;
  const prompt = 'A blue bird';
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#3366ff';
    context.fillRect(0, 0, 32, 32);
    return canvas.toDataURL('image/jpeg');
  });
  await page.route('**/api/images', async route => {
    expect(route.request().postDataJSON()).toEqual({ prompt });
    await route.fulfill({ status: failing ? 429 : 200, contentType: 'application/json', body: JSON.stringify(failing ? { error: 'Image usage limit reached.' } : { image: { dataUrl, prompt } }) });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Create image', exact: true }).click();
  await page.getByLabel('Message', { exact: true }).fill(prompt);
  await page.getByLabel('Send message', { exact: true }).click();
  await expect(page.getByLabel(`Generated image: ${prompt}`, { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('jay-ai:chats:v1'))).toContain('data:image/jpeg;base64,');
  await page.reload();
  await expect(page.getByLabel(`Generated image: ${prompt}`, { exact: true })).toBeVisible();
  failing = true;
  await page.getByRole('button', { name: 'Create image', exact: true }).click();
  await page.getByLabel('Message', { exact: true }).fill(prompt);
  await page.getByLabel('Send message', { exact: true }).click();
  await expect(page.getByText('Image usage limit reached.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(prompt);
});

for (const [name, width, height] of [['small-phone', 320, 568], ['phone', 390, 844], ['landscape-phone', 844, 390], ['tablet', 1024, 768]] as const) {
  test(`layout fits ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await expect(page.getByLabel('Message', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Take a photo', { exact: true })).toBeVisible();
    const send = await page.getByLabel('Send message', { exact: true }).boundingBox();
    expect(send).not.toBeNull();
    expect(send!.x).toBeGreaterThanOrEqual(0);
    expect(send!.x + send!.width).toBeLessThanOrEqual(width);
    expect(send!.y + send!.height).toBeLessThanOrEqual(height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (width >= 900) await expect(page.getByText('YOUR CONVERSATIONS', { exact: true })).toBeVisible();
    else {
      await page.getByLabel('Open chat history').click();
      await expect(page.getByText('YOUR CONVERSATIONS', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Close chat history', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Close chat history', exact: true })).not.toBeVisible();
    }
    await page.screenshot({ path: `test-results/${name}.png`, fullPage: true });
  });
}

test('replies render emphasis and links, persist, and keep failed drafts for retry', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let failing = false;
  await page.route('**/api/chat', route => failing
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Try again shortly.' }) })
    : route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ delta: '**A clear answer**\n\n- First point\n- Second point\n\n[Source](https://example.com)' })}\n\ndata: {"done":true}\n\n` }));
  await page.goto('/');
  await page.getByLabel('Message', { exact: true }).fill('Explain this');
  await page.getByLabel('Send message', { exact: true }).click();
  await expect(page.getByText('A clear answer', { exact: true })).toBeVisible();
  await expect(page.getByText('Source', { exact: true })).toBeVisible();
  expect(await page.locator('body').innerText()).not.toContain('**');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('jay-ai:chats:v1'))).toContain('A clear answer');
  await page.reload();
  await expect(page.getByText('A clear answer', { exact: true })).toBeVisible();
  failing = true;
  await page.getByLabel('Message', { exact: true }).fill('Keep this draft');
  await page.getByLabel('Send message', { exact: true }).click();
  await expect(page.getByText('Try again shortly.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Keep this draft');
});

test('connection settings check and save the server', async ({ page }) => {
  await page.route('**/health', route => route.fulfill({ contentType: 'application/json', body: '{"ok":true}' }));
  await page.goto('/');
  await page.getByLabel('Connection settings').click();
  await expect(page.getByLabel('Server address', { exact: true })).toHaveValue('https://chatbot-kr7o.onrender.com');
  await page.getByText('Test connection & save', { exact: true }).click();
  await expect(page.getByText('Connected. Your server is ready.', { exact: true })).toBeVisible();
});
