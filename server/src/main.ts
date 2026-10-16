import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

export async function createApp() {
  const app = await NestFactory.create(AppModule, {
    logger: process.env.NODE_ENV === 'test' ? ['warn', 'error'] : undefined,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors();
  app.enableShutdownHooks();
  return app;
}

if (require.main === module) {
  createApp().then(async (app) => {
    const port = Number(process.env.PORT ?? 3000);
    await app.listen(port);
    console.log(`server listening on :${port}`);
  });
}
