import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = process.env.BACKEND_PORT
    ? parseInt(process.env.BACKEND_PORT)
    : 3000;

  console.log(`应用启动成功，端口 ${port}`);
  await app.listen(port);
}

bootstrap().catch((error) => {
  console.error('Application bootstrap failed:', error);
  process.exit(1);
});
