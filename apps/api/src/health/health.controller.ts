import {
  Controller,
  Get,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Check whether the API process is running' })
  @ApiResponse({ status: 200, description: 'The API process is running.' })
  getHealth(): { status: 'ok'; service: 'netbridge-api' } {
    return {
      status: 'ok',
      service: 'netbridge-api',
    };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Check whether the API and database are ready' })
  @ApiResponse({ status: 200, description: 'The API and database are ready.' })
  @ApiResponse({ status: 503, description: 'The database is not ready.' })
  async getReadiness(): Promise<{
    status: 'ok';
    service: 'netbridge-api';
    database: 'ok';
  }> {
    try {
      await this.prisma.$queryRaw(Prisma.sql`SELECT 1`);
    } catch (error: unknown) {
      this.logger.warn(
        `Database readiness check failed (${error instanceof Error ? error.name : 'UnknownError'})`,
      );
      throw new ServiceUnavailableException('Database is not ready');
    }

    return {
      status: 'ok',
      service: 'netbridge-api',
      database: 'ok',
    };
  }
}
