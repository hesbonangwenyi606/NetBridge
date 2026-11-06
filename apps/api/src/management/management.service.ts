import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectionDto, DeviceDto, ListDto, NameDto } from './dto';
import { newToken, tokenHash } from './security';

const gatewayView = {
  id: true, name: true, status: true, pairedAt: true, lastSeenAt: true, createdAt: true,
} as const;

function paging(dto: ListDto) {
  return { take: dto.limit + 1, ...(dto.cursor ? { cursor: { id: dto.cursor }, skip: 1 } : {}) };
}

function page<T extends { id: string }>(items: T[], limit: number) {
  const more = items.length > limit;
  const visible = items.slice(0, limit);
  return { items: visible, nextCursor: more ? visible.at(-1)!.id : null };
}

@Injectable()
export class ManagementService {
  constructor(private readonly prisma: PrismaService) {}

  // Serialize approval/revocation against session creation; retry PostgreSQL serialization conflicts.
  private async atomic<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(work, { isolationLevel: 'Serializable' });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < 3) continue;
        if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
          throw new ConflictException('Conflicting operation; refresh and try again');
        }
        throw error;
      }
    }
  }

  async createGateway(ownerId: string, dto: NameDto) {
    const pairingToken = newToken();
    const pairingExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const gateway = await this.prisma.gateway.create({
      data: { ownerId, name: dto.name, pairingTokenHash: tokenHash(pairingToken), pairingExpiresAt }, select: gatewayView,
    });
    return { ...gateway, pairingToken, pairingExpiresAt };
  }

  async listGateways(ownerId: string, dto: ListDto) {
    return page(await this.prisma.gateway.findMany({
      where: { ownerId }, select: gatewayView, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...paging(dto),
    }), dto.limit);
  }

  async getGateway(ownerId: string, id: string) {
    const gateway = await this.prisma.gateway.findFirst({ where: { id, ownerId }, select: gatewayView });
    if (!gateway) throw new NotFoundException('Gateway not found');
    return gateway;
  }

  async renewPairing(ownerId: string, id: string) {
    return this.atomic(async (tx) => {
      const gateway = await tx.gateway.findFirst({ where: { id, ownerId } });
      if (!gateway) throw new NotFoundException('Gateway not found');
      if (gateway.status !== 'PENDING') throw new ConflictException('Only pending gateways can be paired');
      const pairingToken = newToken();
      const pairingExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
      await tx.gateway.update({ where: { id }, data: { pairingTokenHash: tokenHash(pairingToken), pairingExpiresAt } });
      return { pairingToken, pairingExpiresAt };
    });
  }

  async pairGateway(pairingToken: string) {
    return this.atomic(async (tx) => {
      const now = new Date();
      const gateway = await tx.gateway.findUnique({ where: { pairingTokenHash: tokenHash(pairingToken) } });
      if (!gateway || gateway.status !== 'PENDING' || !gateway.pairingExpiresAt || gateway.pairingExpiresAt <= now) {
        throw new UnauthorizedException('Invalid or expired pairing token');
      }
      const gatewayToken = newToken();
      const paired = await tx.gateway.update({
        where: { id: gateway.id },
        data: { status: 'PAIRED', pairedAt: now, lastSeenAt: now, credentialHash: tokenHash(gatewayToken), pairingTokenHash: null, pairingExpiresAt: null },
        select: gatewayView,
      });
      return { ...paired, gatewayToken };
    });
  }

  async heartbeat(token: string) {
    const result = await this.prisma.gateway.updateMany({
      where: { credentialHash: tokenHash(token), status: 'PAIRED' }, data: { lastSeenAt: new Date() },
    });
    if (result.count !== 1) throw new UnauthorizedException('Invalid gateway credential');
    return { status: 'ok' };
  }

  async revokeGateway(ownerId: string, id: string) {
    return this.atomic(async (tx) => {
      if (!await tx.gateway.findFirst({ where: { id, ownerId } })) throw new NotFoundException('Gateway not found');
      await tx.connection.updateMany({ where: { gatewayId: id, status: 'ACTIVE' }, data: { status: 'ENDED', endedAt: new Date() } });
      return tx.gateway.update({
        where: { id }, data: { status: 'REVOKED', credentialHash: null, pairingTokenHash: null, pairingExpiresAt: null }, select: gatewayView,
      });
    });
  }

  createDevice(ownerId: string, dto: DeviceDto) {
    return this.prisma.device.create({ data: { ownerId, name: dto.name, platform: dto.platform } });
  }

  async listDevices(ownerId: string, dto: ListDto) {
    return page(await this.prisma.device.findMany({ where: { ownerId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...paging(dto) }), dto.limit);
  }

  async getDevice(ownerId: string, id: string) {
    const device = await this.prisma.device.findFirst({ where: { id, ownerId } });
    if (!device) throw new NotFoundException('Device not found');
    return device;
  }

  async approveDevice(ownerId: string, id: string) {
    return this.atomic(async (tx) => {
      const device = await tx.device.findFirst({ where: { id, ownerId } });
      if (!device) throw new NotFoundException('Device not found');
      if (device.status === 'REVOKED') throw new ConflictException('Revoked devices cannot be approved; register a new device');
      return tx.device.update({ where: { id }, data: { status: 'APPROVED', approvedAt: device.approvedAt ?? new Date() } });
    });
  }

  async revokeDevice(ownerId: string, id: string) {
    return this.atomic(async (tx) => {
      if (!await tx.device.findFirst({ where: { id, ownerId } })) throw new NotFoundException('Device not found');
      await tx.connection.updateMany({ where: { deviceId: id, status: 'ACTIVE' }, data: { status: 'ENDED', endedAt: new Date() } });
      return tx.device.update({ where: { id }, data: { status: 'REVOKED' } });
    });
  }

  async createConnection(ownerId: string, dto: ConnectionDto) {
    return this.atomic(async (tx) => {
      const gateway = await tx.gateway.findFirst({ where: { id: dto.gatewayId, ownerId } });
      const device = await tx.device.findFirst({ where: { id: dto.deviceId, ownerId } });
      if (!gateway || !device) throw new NotFoundException('Gateway or device not found');
      if (gateway.status !== 'PAIRED' || device.status !== 'APPROVED') {
        throw new ConflictException('A paired gateway and approved device are required');
      }
      if (await tx.connection.findFirst({ where: { deviceId: device.id, status: 'ACTIVE' } })) {
        throw new ConflictException('Device already has an active connection record');
      }
      return tx.connection.create({ data: { gatewayId: gateway.id, deviceId: device.id } });
    });
  }

  async listConnections(ownerId: string, dto: ListDto) {
    return page(await this.prisma.connection.findMany({
      where: { device: { ownerId } }, orderBy: [{ startedAt: 'desc' }, { id: 'desc' }], ...paging(dto),
    }), dto.limit);
  }

  async getConnection(ownerId: string, id: string) {
    const connection = await this.prisma.connection.findFirst({ where: { id, device: { ownerId } } });
    if (!connection) throw new NotFoundException('Connection not found');
    return connection;
  }

  async endConnection(ownerId: string, id: string) {
    return this.atomic(async (tx) => {
      const connection = await tx.connection.findFirst({ where: { id, device: { ownerId } } });
      if (!connection) throw new NotFoundException('Connection not found');
      if (connection.status === 'ENDED') return connection;
      return tx.connection.update({ where: { id }, data: { status: 'ENDED', endedAt: new Date() } });
    });
  }
}
