import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialsDto } from './dto';
import { hashPassword, newToken, tokenHash, verifyPassword } from './security';

const publicUser = { id: true, email: true, createdAt: true } as const;

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async register(dto: CredentialsDto) {
    const passwordHash = await hashPassword(dto.password);
    try {
      return await this.prisma.user.create({
        data: { email: dto.email, passwordHash }, select: publicUser,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Email is already registered');
      }
      throw error;
    }
  }

  async login(dto: CredentialsDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    // Do the same expensive password operation for unknown accounts.
    const encoded = user?.passwordHash ?? `scrypt:${'0'.repeat(32)}:${'0'.repeat(128)}`;
    const valid = await verifyPassword(dto.password, encoded);
    if (!user || !valid) throw new UnauthorizedException('Invalid email or password');
    const accessToken = newToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await this.prisma.$transaction([
      this.prisma.authSession.deleteMany({ where: { userId: user.id, expiresAt: { lte: new Date() } } }),
      this.prisma.authSession.create({ data: { userId: user.id, tokenHash: tokenHash(accessToken), expiresAt } }),
    ]);
    return { accessToken, tokenType: 'Bearer', expiresAt };
  }

  async authenticate(token: string) {
    const session = await this.prisma.authSession.findUnique({ where: { tokenHash: tokenHash(token) } });
    if (!session || session.expiresAt <= new Date()) throw new UnauthorizedException('Invalid or expired token');
    return { userId: session.userId, sessionId: session.id };
  }

  async me(userId: string) {
    return this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: publicUser });
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.authSession.deleteMany({ where: { id: sessionId } });
  }
}
