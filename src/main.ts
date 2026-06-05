import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { API_ROUTE_PREFIX } from './common/config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors();
  if (API_ROUTE_PREFIX) {
    app.setGlobalPrefix(API_ROUTE_PREFIX);
  }
  app.useStaticAssets(join(process.cwd(), 'public'));

  const port = Number(process.env.PORT ?? 3019);
  await app.listen(port);
}

void bootstrap();
