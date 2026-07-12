import { ExceptionFilter, Catch, ArgumentsHost, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { LoggerService } from '../logger';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new LoggerService(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const status = exception instanceof Error ? HttpStatus.INTERNAL_SERVER_ERROR : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = exception instanceof Error ? exception.message : 'Unknown error';

    this.logger.error(`未处理异常 - 错误: ${message}`, exception instanceof Error ? exception.stack : undefined);

    response.status(status).json({
      success: false,
      message,
      error: exception instanceof Error ? exception.name : undefined,
      timestamp: new Date().toISOString(),
    });
  }
}
