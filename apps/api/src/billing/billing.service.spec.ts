import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { ConfigService } from '@nestjs/config';
let BillingService: any;
before(async () => { ({ BillingService } = await import('../../dist/src/billing/billing.service.js')); });
const reference = `nb_${'a'.repeat(32)}`;
function fixture() {
  let record: any = { id:'payment', userId:'owner', reference, plan:'daily', amount:2500, paidAt:null, expiresAt:null, user:{email:'owner@example.com'} };
  let updates = 0;
  const prisma = {
    user:{findUniqueOrThrow:async()=>({email:'owner@example.com'})},
    payment:{
      create:async({data}:any)=>{record={...record,...data};return record},
      findUnique:async({where}:any)=>where.reference===record.reference ? {userId:record.userId} : null,
      findFirst:async({where}:any)=>where.userId==='owner' && where.reference===record.reference ? record : null,
      updateMany:async({data}:any)=>{record={...record,...data};updates++;return{count:1}},
    },
  };
  const service = new BillingService(prisma, new ConfigService({PAYSTACK_SECRET_KEY:'sk_test_placeholder',PAYSTACK_CALLBACK_URL:'http://127.0.0.1:5173/'}));
  return {service, get record(){return record}, get updates(){return updates}};
}
function reply(data: any) {return new Response(JSON.stringify({status:true,data}),{status:200,headers:{'Content-Type':'application/json'}})}
test('checkout uses server prices and channels, and rejects an untrusted checkout URL', async () => {
  const original=globalThis.fetch;
  try {
    const f=fixture();
    for(const [plan,channel,amount] of [['daily','mpesa',2500],['weekly','card',12000],['monthly','card',70000]] as const){
      globalThis.fetch=async(_url,options)=>{const body=JSON.parse(String(options?.body));assert.equal(body.amount,amount);assert.equal(body.currency,'KES');assert.deepEqual(body.channels,[channel==='mpesa'?'mobile_money':'card']);return reply({reference:body.reference,authorization_url:'https://checkout.paystack.com/test'})};
      const result=await f.service.initialize('owner',plan,channel);assert.match(result.reference,/^nb_[a-f0-9]{32}$/);
    }
    globalThis.fetch=async()=>reply({reference:f.record.reference,authorization_url:'https://evil.example/checkout'});
    await assert.rejects(f.service.initialize('owner','daily','card'),/Invalid Paystack/);
  }finally{globalThis.fetch=original}
});
test('verification checks ownership and exact payment details, and grants a fixed duration only once',async()=>{
  const original=globalThis.fetch;
  const confirmed={status:'success',reference,amount:2500,currency:'KES',customer:{email:'owner@example.com'},paid_at:new Date().toISOString()};
  try{
    const f=fixture();let calls=0;
    globalThis.fetch=async()=>{calls++;return reply(confirmed)};
    await assert.rejects(f.service.verify('other',reference),/Payment not found/);assert.equal(calls,0);
    for(const patch of [{amount:1},{currency:'USD'},{customer:{email:'other@example.com'}},{reference:`nb_${'b'.repeat(32)}`}]){
      globalThis.fetch=async()=>reply({...confirmed,...patch});
      await assert.rejects(f.service.verify('owner',reference),/do not match/);assert.equal(f.updates,0);
    }
    globalThis.fetch=async()=>reply(confirmed);
    const result=await f.service.verify('owner',reference);assert.equal(result.status,'success');
    assert.equal(new Date(result.expiresAt).getTime()-new Date(confirmed.paid_at).getTime(),86400000);
    await f.service.verify('owner',reference);assert.equal(f.updates,1);
  }finally{globalThis.fetch=original}
});
test('pending, failed, and unavailable provider responses never activate a subscription',async()=>{
  const original=globalThis.fetch;
  try{
    const f=fixture();
    for(const [status,expected] of [['pending','pending'],['failed','failed'],['abandoned','failed']]){
      globalThis.fetch=async()=>reply({status});assert.equal((await f.service.verify('owner',reference)).status,expected);assert.equal(f.updates,0);
    }
    globalThis.fetch=async()=>{throw new Error('network')};await assert.rejects(f.service.verify('owner',reference),/unavailable/);assert.equal(f.updates,0);
    const disabled=new BillingService({},new ConfigService({}));assert.equal(disabled.configuration().enabled,false);await assert.rejects(disabled.initialize('owner','daily','card'),/not configured/);
  }finally{globalThis.fetch=original}
});

test('webhooks reject forged bodies and stale signatures for both signature schemes', async()=>{
  const {createHmac}=await import('node:crypto');
  const raw=Buffer.from('{ "event": "ping" }');
  const legacy=createHmac('sha512','sk_test_placeholder').update(raw).digest('hex');
  const f=fixture();
  await assert.rejects(f.service.webhook(raw,undefined,'0'.repeat(128)),/Invalid webhook/);
  await assert.rejects(f.service.webhook(Buffer.from('{}'),undefined,legacy),/Invalid webhook/);
  assert.deepEqual(await f.service.webhook(raw,undefined,legacy),{received:true});
  const secret='whsec_test_placeholder',timestamp=String(Math.floor(Date.now()/1000));
  const modern=new BillingService({},new ConfigService({PAYSTACK_WEBHOOK_SECRET:secret}));
  const signature=createHmac('sha512',secret).update(timestamp+'.').update(raw).digest('hex');
  assert.deepEqual(await modern.webhook(raw,`t=${timestamp},v1=whk_test:${signature}`),{received:true});
  await assert.rejects(modern.webhook(raw,`t=1,v1=whk_test:${signature}`),/Invalid webhook/);
  await assert.rejects(modern.webhook(raw,undefined,legacy),/Invalid webhook/);
});

test('a signed success event verifies independently and duplicate deliveries cannot extend access',async()=>{
  const {createHmac}=await import('node:crypto');
  const f=fixture(), original=globalThis.fetch;
  const raw=Buffer.from(JSON.stringify({event:'charge.success',data:{reference,amount:1}}));
  const signature=createHmac('sha512','sk_test_placeholder').update(raw).digest('hex');
  try {
    globalThis.fetch=async()=>reply({status:'success',reference,amount:2500,currency:'KES',customer:{email:'owner@example.com'},paid_at:new Date().toISOString()});
    await f.service.webhook(raw,undefined,signature);
    await f.service.webhook(raw,undefined,signature);
    assert.equal(f.updates,1);
  } finally {globalThis.fetch=original;}
});
