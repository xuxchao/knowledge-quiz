import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggerService } from './common/logger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const logger = app.get(LoggerService);
  app.useLogger(logger);

  app.enableCors();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter(), new AllExceptionsFilter());

  const port = process.env.BACKEND_PORT ? parseInt(process.env.BACKEND_PORT) : 3000;

  logger.log(`应用启动成功，端口 ${port}`, 'Bootstrap');
  await app.listen(port);
}

bootstrap().catch((error) => {
  const logger = new LoggerService('Bootstrap');
  logger.error('应用启动失败', error instanceof Error ? error.stack : undefined, 'Bootstrap');
  process.exit(1);
});
