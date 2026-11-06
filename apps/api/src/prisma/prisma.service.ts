import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(config: ConfigService) {
    const connectionString = config.getOrThrow<string>('DATABASE_URL');
    super({
      adapter: new PrismaPg({
        connectionString,
        max: config.getOrThrow<number>('DATABASE_POOL_MAX'),
        connectionTimeoutMillis: 5000,
        query_timeout: 10000,
      }, { schema: new URL(connectionString).searchParams.get('schema') ?? 'public' }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    // Creating a pool alone does not prove that PostgreSQL is reachable.
    await this.$queryRaw`SELECT 1`;
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
