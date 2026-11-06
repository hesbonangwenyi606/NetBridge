import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard, bearerToken, CurrentUser, Principal } from './auth.guard';
import { AuthService } from './auth.service';
import { ConnectionDto, CredentialsDto, RegisterDto, DeviceDto, ListDto, NameDto, PairGatewayDto } from './dto';
import { ManagementService } from './management.service';
import { RateLimitGuard } from './rate-limit.guard';

@ApiTags('accounts')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @UseGuards(RateLimitGuard)
  register(@Body() dto: RegisterDto) { return this.auth.register(dto); }

  @Post('login')
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  login(@Body() dto: CredentialsDto) { return this.auth.login(dto); }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: Principal) { return this.auth.me(user.userId); }

  @Post('logout')
  @HttpCode(204)
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  logout(@CurrentUser() user: Principal) { return this.auth.logout(user.sessionId); }
}

@ApiTags('dashboard')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly management: ManagementService) {}

  @Get()
  @ApiOperation({ summary: 'Get account-wide resource counts for the dashboard' })
  get(@CurrentUser() user: Principal) { return this.management.dashboard(user.userId); }
}

@ApiTags('gateway-agent')
@Controller('gateway-agent')
export class GatewayAgentController {
  constructor(private readonly management: ManagementService) {}

  @Post('pair')
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  @ApiOperation({ summary: 'Consume a single-use pairing token and receive a gateway credential' })
  pair(@Body() dto: PairGatewayDto) { return this.management.pairGateway(dto.pairingToken); }

  @Post('heartbeat')
  @HttpCode(200)
  @ApiBearerAuth('gateway-token')
  heartbeat(@Headers('authorization') authorization?: string) {
    return this.management.heartbeat(bearerToken(authorization));
  }
}

@ApiTags('gateways')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('gateways')
export class GatewaysController {
  constructor(private readonly management: ManagementService) {}

  @Post()
  create(@CurrentUser() user: Principal, @Body() dto: NameDto) { return this.management.createGateway(user.userId, dto); }

  @Get()
  list(@CurrentUser() user: Principal, @Query() dto: ListDto) { return this.management.listGateways(user.userId, dto); }

  @Get(':id')
  get(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) { return this.management.getGateway(user.userId, id); }

  @Post(':id/pairing-token')
  @HttpCode(200)
  renew(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) { return this.management.renewPairing(user.userId, id); }

  @Post(':id/revoke')
  @HttpCode(200)
  revoke(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) { return this.management.revokeGateway(user.userId, id); }
}

@ApiTags('devices')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('devices')
export class DevicesController {
  constructor(private readonly management: ManagementService) {}

  @Post()
  create(@CurrentUser() user: Principal, @Body() dto: DeviceDto) { return this.management.createDevice(user.userId, dto); }

  @Get()
  list(@CurrentUser() user: Principal, @Query() dto: ListDto) { return this.management.listDevices(user.userId, dto); }

  @Get(':id')
  get(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) { return this.management.getDevice(user.userId, id); }

  @Post(':id/approve')
  @HttpCode(200)
  approve(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) { return this.management.approveDevice(user.userId, id); }

  @Post(':id/revoke')
  @HttpCode(200)
  revoke(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) { return this.management.revokeDevice(user.userId, id); }
}

@ApiTags('connections')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('connections')
export class ConnectionsController {
  constructor(private readonly management: ManagementService) {}

  @Post()
  @ApiOperation({ summary: 'Record a connection session; this does not establish a network tunnel' })
  create(@CurrentUser() user: Principal, @Body() dto: ConnectionDto) { return this.management.createConnection(user.userId, dto); }

  @Get()
  list(@CurrentUser() user: Principal, @Query() dto: ListDto) { return this.management.listConnections(user.userId, dto); }

  @Get(':id')
  get(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) { return this.management.getConnection(user.userId, id); }

  @Post(':id/end')
  @HttpCode(200)
  end(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) { return this.management.endConnection(user.userId, id); }
}
