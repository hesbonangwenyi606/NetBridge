import { Transform, Type } from 'class-transformer';
import { IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ListDto {
  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  cursor?: string;
}

export class CredentialsDto {
  @ApiProperty({ example: 'owner@example.com' })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ minLength: 12, maxLength: 128, format: 'password' })
  @IsString()
  @Length(12, 128)
  password!: string;
}

export class RegisterDto extends CredentialsDto {
  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 80)
  firstName?: string;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 80)
  lastName?: string;

  @ApiPropertyOptional({ example: '+254 712 345 678' })
  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Matches(/^[+0-9() .-]{7,30}$/)
  contact?: string;
}

export class NameDto {
  @ApiProperty({ example: 'Home gateway', minLength: 1, maxLength: 80 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 80)
  name!: string;
}

export class DeviceDto extends NameDto {
  @ApiProperty({ enum: ['android', 'ios', 'linux', 'windows', 'macos'] })
  @IsIn(['android', 'ios', 'linux', 'windows', 'macos'])
  platform!: string;
}

export class PairGatewayDto {
  @ApiProperty({ description: 'Single-use token returned when the owner creates a gateway' })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  pairingToken!: string;
}

export class ConnectionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  gatewayId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  deviceId!: string;
}
