import { Body, Controller, Get, Param, Post, UseGuards, Req, Headers, HttpCode } from '@nestjs/common';
import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { AuthGuard, CurrentUser, Principal } from '../management/auth.guard';
import { RateLimitGuard } from '../management/rate-limit.guard';
import { BillingService, PlanId } from './billing.service';
class CheckoutDto {
  @ApiProperty({ enum: ['daily', 'weekly', 'monthly'] })
  @IsIn(['daily', 'weekly', 'monthly']) plan!: PlanId;
  @ApiProperty({ enum: ['mpesa', 'card'] })
  @IsIn(['mpesa', 'card']) channel!: 'mpesa' | 'card';
}
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}
  @Get('config') configuration() { return this.billing.configuration(); }
  @Post('webhook')
  @HttpCode(200)
  webhook(@Req() request: { rawBody?: Buffer }, @Headers('paystack-signature') signature?: string, @Headers('x-paystack-signature') legacySignature?: string) { return this.billing.webhook(request.rawBody, signature, legacySignature); }
  @Post('checkout')
  @UseGuards(AuthGuard, RateLimitGuard)
  checkout(@CurrentUser() user: Principal, @Body() dto: CheckoutDto) { return this.billing.initialize(user.userId, dto.plan, dto.channel); }
  @Post('payments/:reference/verify')
  @UseGuards(AuthGuard)
  verify(@CurrentUser() user: Principal, @Param('reference') reference: string) { return this.billing.verify(user.userId, reference); }
}
