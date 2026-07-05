import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { LoggerService } from './common/logger';

@Controller()
export class AppController {
  private readonly logger = new LoggerService(AppController.name);

  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    this.logger.debug('请求进入 - 获取健康检查');
    const result = this.appService.getHello();
    this.logger.info('请求成功 - 健康检查完成');
    return result;
  }
}
