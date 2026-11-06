import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // Public/internal exposure (loopback-only binding, docker network isolation,
  // etc.) is a docker-compose/infra concern - see docker-compose.yml. In-process
  // this just listens on the given port.
  const port = process.env.PORT || 8100;
  await app.listen(port);
  console.log(`apply-worker started on port ${port}`);
}
bootstrap();
