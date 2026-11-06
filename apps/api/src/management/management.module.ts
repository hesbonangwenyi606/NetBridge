import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { AuthController, ConnectionsController, DashboardController, DevicesController, GatewayAgentController, GatewaysController } from './controllers';
import { ManagementService } from './management.service';
import { RateLimitGuard } from './rate-limit.guard';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController, DashboardController, GatewaysController, GatewayAgentController, DevicesController, ConnectionsController],
  providers: [AuthService, AuthGuard, ManagementService, RateLimitGuard],
})
export class ManagementModule {}
