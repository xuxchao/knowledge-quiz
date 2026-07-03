import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const error = exception.getResponse() as
      string | { message: string | string[]; error?: string };

    this.logger.error(`HTTP Exception: ${status} - ${JSON.stringify(error)}`);

    const message = typeof error === 'string' ? error : error.message;

    response.status(status).json({
      success: false,
      message: Array.isArray(message) ? message.join(', ') : message,
      error: typeof error !== 'string' ? error.error : undefined,
      timestamp: new Date().toISOString(),
    });
  }
}
