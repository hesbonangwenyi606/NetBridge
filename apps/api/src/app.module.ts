import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import Joi from 'joi';
import { HealthModule } from './health/health.module';
import { ManagementModule } from './management/management.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
      validationSchema: Joi.object({
        NODE_ENV: Joi.string()
          .valid('development', 'test', 'production')
          .default('development'),
        HOST: Joi.string().trim().min(1).default('127.0.0.1'),
        PORT: Joi.number().port().default(3000),
        DATABASE_POOL_MAX: Joi.number().integer().min(1).max(100).default(10),
        PAYSTACK_WEBHOOK_SECRET: Joi.string().pattern(/^whsec_/).allow('').optional(),
        PAYSTACK_SECRET_KEY: Joi.string().pattern(/^sk_(test|live)_/).allow('').optional(),
        PAYSTACK_CALLBACK_URL: Joi.string().uri({ scheme: ['http', 'https'] }).allow('').optional(),
        DATABASE_URL: Joi.string()
          .uri({ scheme: ['postgres', 'postgresql'] })
          .required(),
      }),
    }),
    HealthModule,
    ManagementModule,
  ],
})
export class AppModule {}
