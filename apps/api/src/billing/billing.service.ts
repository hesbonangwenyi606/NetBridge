import { BadGatewayException, BadRequestException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

export const PLANS = {
  daily: { amount: 2500, hours: 24 },
  weekly: { amount: 12000, hours: 168 },
  monthly: { amount: 70000, hours: 720 },
} as const;
export type PlanId = keyof typeof PLANS;

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}
  configuration() {
    let validCallback = false;
    try {
      const url = new URL(this.config.get<string>('PAYSTACK_CALLBACK_URL') || '');
      validCallback = !url.username && !url.password && !url.hash && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)));
    } catch {}
    return { enabled: Boolean(this.config.get<string>('PAYSTACK_SECRET_KEY') && validCallback), provider: 'paystack', currency: 'KES' };
  }
  private async paystack(path: string, body?: object): Promise<any> {
    const secret = this.config.get<string>('PAYSTACK_SECRET_KEY');
    if (!secret || !this.configuration().enabled) throw new ServiceUnavailableException('Paystack is not configured yet. No payment has been taken.');
    let response: Response;
    try {
      response = await fetch(`https://api.paystack.co${path}`, {
        method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
      });
    } catch { throw new BadGatewayException('Paystack is unavailable. Please retry without starting another payment.'); }
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.status || !result?.data) throw new BadGatewayException('Paystack could not complete this request.');
    return result.data;
  }
  async webhook(rawBody: Buffer | undefined, signature?: string, legacySignature?: string) {
    if (!rawBody) throw new UnauthorizedException('Missing webhook body');
    const signingSecret = this.config.get<string>('PAYSTACK_WEBHOOK_SECRET');
    const apiSecret = this.config.get<string>('PAYSTACK_SECRET_KEY');
    let valid = false;
    if (signingSecret) {
      const parts = (signature || '').split(',');
      const timestamp = parts.find(part => part.startsWith('t='))?.slice(2);
      if (timestamp && /^\d+$/.test(timestamp) && Math.abs(Date.now() / 1000 - Number(timestamp)) <= 300) {
        const expected = createHmac('sha512', signingSecret).update(timestamp + '.').update(rawBody).digest();
        valid = parts.filter(part => part.startsWith('v1=')).some(part => {
          const candidate = part.slice(3).split(':')[1] || '';
          return /^[0-9a-f]{128}$/.test(candidate) && timingSafeEqual(expected, Buffer.from(candidate, 'hex'));
        });
      }
    } else if (apiSecret && /^[0-9a-f]{128}$/.test(legacySignature || '')) {
      valid = timingSafeEqual(createHmac('sha512', apiSecret).update(rawBody).digest(), Buffer.from(legacySignature!, 'hex'));
    }
    if (!valid) throw new UnauthorizedException('Invalid webhook signature');
    let event: any;
    try { event = JSON.parse(rawBody.toString('utf8')); } catch { throw new BadRequestException('Invalid webhook JSON'); }
    if (event?.event !== 'charge.success' || typeof event.data?.reference !== 'string') return { received: true };
    const reference = event.data.reference;
    const payment = await this.prisma.payment.findUnique({ where: { reference }, select: { userId: true } });
    if (payment) await this.verify(payment.userId, reference);
    return { received: true };
  }
  async initialize(userId: string, planId: PlanId, channel: 'mpesa' | 'card') {
    if (!this.configuration().enabled) throw new ServiceUnavailableException('Paystack is not configured yet.');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
    const reference = `nb_${randomUUID().replaceAll('-', '')}`;
    const plan = PLANS[planId];
    await this.prisma.payment.create({ data: { userId, reference, plan: planId, amount: plan.amount, channel } });
    const result = await this.paystack('/transaction/initialize', {
      email: user.email, amount: plan.amount, currency: 'KES', reference,
      channels: [channel === 'mpesa' ? 'mobile_money' : 'card'], callback_url: this.config.get<string>('PAYSTACK_CALLBACK_URL'),
      metadata: { plan: planId },
    });
    let checkout: URL;
    try { checkout = new URL(result.authorization_url); } catch { throw new BadGatewayException('Invalid Paystack checkout response.'); }
    if (checkout.protocol !== 'https:' || checkout.hostname !== 'checkout.paystack.com' || checkout.username || checkout.password || result.reference !== reference) throw new BadGatewayException('Invalid Paystack checkout response.');
    return { reference, authorizationUrl: checkout.href };
  }
  async verify(userId: string, reference: string) {
    if (!/^nb_[a-f0-9]{32}$/.test(reference)) throw new BadRequestException('Invalid payment reference');
    const payment = await this.prisma.payment.findFirst({ where: { userId, reference }, include: { user: { select: { email: true } } } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.paidAt && payment.expiresAt) return { status: payment.expiresAt > new Date() ? 'success' : 'expired', plan: payment.plan, expiresAt: payment.expiresAt };
    const result = await this.paystack(`/transaction/verify/${encodeURIComponent(reference)}`);
    if (result.status !== 'success') return { status: ['failed', 'abandoned', 'reversed'].includes(result.status) ? 'failed' : 'pending' };
    if (result.reference !== reference || result.amount !== payment.amount || result.currency !== 'KES' || result.customer?.email?.toLowerCase() !== payment.user.email.toLowerCase()) throw new BadGatewayException('Payment details do not match this subscription.');
    const paidAt = new Date(result.paid_at);
    if (!result.paid_at || !Number.isFinite(paidAt.getTime()) || paidAt.getTime() > Date.now() + 300000) throw new BadGatewayException('Invalid payment confirmation time.');
    const plan = PLANS[payment.plan as PlanId];
    if (!plan) throw new BadGatewayException('Unknown subscription plan.');
    const expiresAt = new Date(paidAt.getTime() + plan.hours * 3600000);
    await this.prisma.payment.updateMany({ where: { id: payment.id, paidAt: null }, data: { paidAt, expiresAt } });
    return { status: expiresAt > new Date() ? 'success' : 'expired', plan: payment.plan, expiresAt };
  }
}
