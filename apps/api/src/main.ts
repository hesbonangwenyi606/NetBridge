import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  configureApp(app);
  app.enableShutdownHooks();

  const config = app.get(ConfigService);
  await app.listen(config.getOrThrow<number>('PORT'), config.getOrThrow<string>('HOST'));
}

void bootstrap();
