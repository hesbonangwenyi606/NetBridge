import { test, expect } from '@playwright/test';
import { once } from 'node:events';
import { createWebServer } from '../server.mjs';

test('workspace fits a phone viewport and navigation remains accessible', async ({ page }) => {
  const web = createWebServer();
  web.listen(0, '127.0.0.1');
  await once(web, 'listening');
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => sessionStorage.setItem('netbridge.session', 'layout-test-token'));
    await page.route('**/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      const timestamp = '2026-11-06T09:00:00.000Z';
      const records = {
        '/v1/gateways': [{ id: 'gateway-layout', name: 'Home office gateway', status: 'PAIRED', createdAt: timestamp, lastSeenAt: timestamp }],
        '/v1/devices': [{ id: 'device-layout', name: 'My approved phone', status: 'APPROVED', platform: 'android', createdAt: timestamp }],
        '/v1/connections': [{ id: 'connection-layout', deviceId: 'device-layout', gatewayId: 'gateway-layout', status: 'ENDED', startedAt: timestamp, endedAt: timestamp }],
      };
      const body = path === '/v1/auth/me' ? { email: 'layout@example.com' }
        : path === '/v1/dashboard' ? { pairedGateways: 1, approvedDevices: 1, activeConnections: 0, pendingDevices: 0 }
        : { items: records[path] ?? [], nextCursor: null };
      await route.fulfill({ json: body });
    });
    await page.goto(`http://127.0.0.1:${web.address().port}/#overview`);
    await expect(page.getByRole('heading', { name: 'Workspace overview' })).toBeVisible();
    await expect(page.locator('.loading-block')).toHaveCount(0);
    const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      overflowing: [...document.querySelectorAll('body *')].filter((node) => node.getBoundingClientRect().right > innerWidth + 1).slice(0, 10).map((node) => node.tagName + '.' + node.className) }));
    expect(layout.scrollWidth, JSON.stringify(layout)).toBeLessThanOrEqual(layout.width);
    await page.screenshot({ path: 'test-results/netbridge-mobile-layout.png', fullPage: true });
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
    await page.getByRole('link', { name: 'Connections', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Connections', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await new Promise((resolve) => web.close(resolve)); }
});
