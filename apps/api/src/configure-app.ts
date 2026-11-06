import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { INestApplication } from '@nestjs/common';
import { createRequestLogger } from './logging/request-logging.middleware';

export function configureApp(app: INestApplication): void {
  app.use(createRequestLogger());
  app.use((_request: unknown, response: { setHeader(name: string, value: string): void }, next: () => void) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('NetBridge API')
    .setDescription('Account and gateway management API for NetBridge.')
    .setVersion('1.0')
    .addBearerAuth()
    .addBearerAuth({ type: 'http', scheme: 'bearer', description: 'Gateway credential returned by pairing' }, 'gateway-token')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
}
