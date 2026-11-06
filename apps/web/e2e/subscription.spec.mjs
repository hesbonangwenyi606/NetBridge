import { test, expect } from '@playwright/test';
import { once } from 'node:events';
import { createWebServer } from '../server.mjs';

test('phone plans fit small screens and never activate billing', async ({ page }) => {
  const server = createWebServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const mutations = [];
  await page.addInitScript(() => sessionStorage.setItem('netbridge.session', 'phone-preview'));
  await page.route('**/v1/**', async route => {
    if (route.request().method() !== 'GET') mutations.push(route.request().url());
    const path = new URL(route.request().url()).pathname;
    const body = path === '/v1/auth/me' ? { email:'phone@example.com',firstName:'Alex',lastName:'Owner' }
      : path === '/v1/health/ready' ? {status:'ok'}
      : path === '/v1/dashboard' ? {pairedGateways:0,approvedDevices:0,activeConnections:0,pendingDevices:0}
      : {items:[],nextCursor:null};
    await route.fulfill({json:body});
  });
  try {
    for (const width of [320,390,430]) {
      await page.setViewportSize({width,height:844});
      await page.goto(`http://127.0.0.1:${server.address().port}/#overview`);
      await expect(page.getByRole('heading',{name:'Workspace overview'})).toBeVisible();
      const navigation=page.getByRole('navigation',{name:'Phone navigation'});
      await expect(navigation).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      if(width===390) await page.screenshot({path:'test-results/phone-home.png',fullPage:true});
      await expect(navigation.getByRole('link',{name:'Home',exact:true})).toHaveAttribute('aria-current','page');
      await expect(page.locator('.plan-card')).toHaveCount(3);
      await expect(page.locator('.plans-grid')).not.toContainText('Family');
      await expect(page.locator('.preview-label').first()).toContainText('Not yet available');
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      if(width===390) await page.screenshot({path:'test-results/phone-plans.png',fullPage:true});
      const cards = page.locator('.plan-card');
      for (const [index, duration, price] of [[0,'24 hours',25],[1,'7 days',120],[2,'30 days',700]]) {
        await expect(cards.nth(index).getByRole('heading')).toHaveText(duration);
        await expect(cards.nth(index).locator('.plan-price')).toContainText(`KSh ${price}`);
        await cards.nth(index).getByRole('button').click();
        await expect(page.locator('.checkout-summary')).toContainText(duration);
        await expect(page.locator('.checkout-summary')).toContainText(`KSh ${price}`);
        await page.getByRole('button',{name:'Back to subscription',exact:true}).click();
      }
      await page.getByRole('button',{name:'Choose 7 days',exact:true}).click();
      await expect(page.getByRole('dialog')).toContainText('No subscription has been activated');
      await expect(page.getByRole('radio',{name:/M-Pesa/})).toBeChecked();
      await expect(page.getByRole('textbox',{name:'M-Pesa phone number'})).toBeVisible();
      await page.getByRole('radio',{name:/Debit/}).check();
      await expect(page.getByRole('textbox',{name:'M-Pesa phone number'})).toBeHidden();
      await expect(page.locator('#card-payment')).toContainText('secure checkout');
      await expect(page.getByRole('button',{name:'Payments coming soon'})).toBeDisabled();
      await page.getByRole('radio',{name:/M-Pesa/}).check();
      await expect(page.getByRole('textbox',{name:'M-Pesa phone number'})).toBeVisible();
      if(width===390) await page.screenshot({path:'test-results/phone-payment.png'});
      await page.getByRole('button',{name:'Back to subscription',exact:true}).click();
      await navigation.getByRole('link',{name:'My devices',exact:true}).click();
      await expect(page.getByRole('heading',{name:'Devices',exact:true})).toBeVisible();
    }
    expect(mutations).toEqual([]);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
