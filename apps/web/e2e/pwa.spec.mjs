import { test, expect, chromium } from '@playwright/test';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWebServer } from '../server.mjs';

test('app manifest, install action, and offline shell work without caching API data', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'netbridge-pwa-'));
  const context = await chromium.launchPersistentContext(profile, { channel: process.platform === 'win32' ? (process.env.PLAYWRIGHT_CHANNEL ?? 'msedge') : undefined, headless: true });
  const page = await context.newPage();
  const web = createWebServer();
  web.listen(0, '127.0.0.1');
  await once(web, 'listening');
  const origin = `http://127.0.0.1:${web.address().port}`;
  try {
    await page.goto(origin);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    const manifestResponse = await page.request.get(`${origin}/manifest.webmanifest`);
    expect(manifestResponse.headers()['content-type']).toContain('application/manifest+json');
    const manifest = await manifestResponse.json();
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.map(icon => icon.sizes)).toEqual(['192x192', '512x512']);
    for (const icon of manifest.icons) {
      const dimensions = await page.evaluate(src => new Promise((resolve, reject) => {
        const image = new Image(); image.onload = () => resolve([image.width, image.height]); image.onerror = reject; image.src = src;
      }), icon.src);
      expect(dimensions.join('x')).toBe(icon.sizes);
    }
    const cdp = await context.newCDPSession(page);
    await cdp.send('Page.enable');
    const result = await cdp.send('Page.getInstallabilityErrors');
    expect(result.installabilityErrors).toEqual([]);
    await page.evaluate(() => {
      const event = new Event('beforeinstallprompt', {cancelable: true});
      event.prompt = async () => { window.installClicked = true; };
      event.userChoice = Promise.resolve({outcome: 'accepted'});
      window.dispatchEvent(event);
    });
    await page.getByRole('button', {name:'Install NetBridge',exact:true}).click();
    expect(await page.evaluate(() => window.installClicked)).toBe(true);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', {name:'Welcome back.'})).toBeVisible();
    const cached = await page.evaluate(async () => {
      const keys = await caches.keys();
      return (await Promise.all(keys.map(async key => (await (await caches.open(key)).keys()).map(request => new URL(request.url).pathname)))).flat();
    });
    expect(cached).toContain('/app.js');
    expect(cached.some(path => path.startsWith('/v1'))).toBe(false);
  } finally {
    await context.setOffline(false);
    await context.close();
    await new Promise(resolve => web.close(resolve));
    await rm(profile, { recursive: true, force: true });
  }
});
