import { test, expect } from '@playwright/test';
import { once } from 'node:events';
import { createWebServer } from '../server.mjs';

test('only a verified payment opens gateway selection and only confirmed pairing shows success', async ({ page }) => {
  const web=createWebServer();web.listen(0,'127.0.0.1');await once(web,'listening');
  const reference=`nb_${'a'.repeat(32)}`;
  const gateway={id:'home-gateway',name:'Home PC',status:'PENDING',createdAt:new Date().toISOString()};
  let paid=false,paired=false,generated=0;
  await page.addInitScript(()=>sessionStorage.setItem('netbridge.session','billing-test-token'));
  await page.route('**/v1/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    let body;
    if(path==='/v1/billing/config')body={enabled:true};
    else if(path===`/v1/billing/payments/${reference}/verify`)body={status:paid?'success':'pending'};
    else if(path==='/v1/auth/me')body={email:'owner@example.com'};
    else if(path==='/v1/dashboard')body={pairedGateways:0,approvedDevices:0,activeConnections:0,pendingDevices:0};
    else if(path==='/v1/gateways')body={items:[gateway],nextCursor:null};
    else if(path==='/v1/gateways/home-gateway')body={...gateway,status:paired?'PAIRED':'PENDING'};
    else if(path==='/v1/gateways/home-gateway/pairing-token'){generated++;body={pairingToken:'p'.repeat(43),pairingExpiresAt:new Date(Date.now()+600000).toISOString()}};
    if(!body)body={items:[],nextCursor:null};
    await route.fulfill({json:body});
  });
  try{
    await page.goto(`http://127.0.0.1:${web.address().port}/?reference=${reference}`);
    await expect(page.getByRole('heading',{name:'Waiting for payment',exact:true})).toBeVisible();
    await expect(page.getByRole('heading',{name:'Choose your gateway',exact:true})).toHaveCount(0);
    expect(generated).toBe(0);
    paid=true;
    await page.getByRole('button',{name:'Check payment status',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Choose your gateway',exact:true})).toBeVisible();
    await page.getByLabel('Gateway',{exact:true}).selectOption('home-gateway');
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    await expect(page.getByLabel('Pairing token',{exact:true})).toHaveValue('p'.repeat(43));
    expect(generated).toBe(1);
    await expect(page.getByRole('heading',{name:'Gateway paired successfully',exact:true})).toHaveCount(0);
    paired=true;
    await page.getByRole('button',{name:'Done, check status'}).click();
    await expect(page.getByRole('heading',{name:'Gateway paired successfully',exact:true})).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('Pairing alone does not confirm internet traffic');
    await page.getByRole('button',{name:'View gateway',exact:true}).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  }finally{await new Promise(resolve=>web.close(resolve));}
});
