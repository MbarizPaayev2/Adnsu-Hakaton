import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../database/database.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  console.log('--- REMOVING BOSS.AZ-SOURCED JOBS ---');

  const { count } = await prisma.job.deleteMany({
    where: { url: { startsWith: 'https://boss.az/' } },
  });

  console.log(`Deleted ${count} boss.az job(s) (Match rows cascade; tailored Resume rows are unlinked, not deleted).`);

  await app.close();
}

bootstrap();
