import { LoggerService } from './logger.service';

interface LoggerAware {
  logger?: LoggerService;
}

export function LogAsync() {
  return function <T extends LoggerAware>(
    target: T,
    propertyKey: string,
    descriptor: TypedPropertyDescriptor<
      (this: T, ...args: unknown[]) => Promise<unknown>
    >,
  ) {
    const originalMethod = descriptor.value;
    const className = target.constructor.name;

    descriptor.value = async function (this: T, ...args: unknown[]) {
      const logger = this.logger || new LoggerService(className);
      const methodName = `${className}.${propertyKey}`;

      logger.debug(`异步操作开始 - ${methodName}`);
      const startTime = Date.now();

      try {
        const result = (await originalMethod!.apply(
          this,
          args,
        )) as Promise<unknown>;
        const duration = Date.now() - startTime;
        logger.debug(`异步操作成功完成 - ${methodName}，耗时: ${duration}ms`);
        return result;
      } catch (error: unknown) {
        const duration = Date.now() - startTime;
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const stackTrace = error instanceof Error ? error.stack : undefined;
        logger.error(
          `异步操作失败 - ${methodName}，耗时: ${duration}ms，错误: ${errorMessage}`,
          stackTrace,
        );
        throw error;
      }
    };

    return descriptor;
  };
}

export function LogStep(stepName: string) {
  return function <T extends LoggerAware>(
    target: T,
    propertyKey: string,
    descriptor: TypedPropertyDescriptor<
      (this: T, ...args: unknown[]) => unknown
    >,
  ) {
    const originalMethod = descriptor.value;
    const className = target.constructor.name;

    descriptor.value = function (this: T, ...args: unknown[]) {
      const logger = this.logger || new LoggerService(className);

      logger.debug(`步骤开始 - ${stepName}`);
      const startTime = Date.now();

      try {
        const result = originalMethod!.apply(this, args) as unknown;
        const duration = Date.now() - startTime;
        logger.debug(`步骤成功完成 - ${stepName}，耗时: ${duration}ms`);
        return result;
      } catch (error: unknown) {
        const duration = Date.now() - startTime;
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const stackTrace = error instanceof Error ? error.stack : undefined;
        logger.error(
          `步骤执行失败 - ${stepName}，耗时: ${duration}ms，错误: ${errorMessage}`,
          stackTrace,
        );
        throw error;
      }
    };

    return descriptor;
  };
}

export function LogServiceCall() {
  return function <T extends LoggerAware>(
    target: T,
    propertyKey: string,
    descriptor: TypedPropertyDescriptor<
      (this: T, ...args: unknown[]) => Promise<unknown>
    >,
  ) {
    const originalMethod = descriptor.value;
    const serviceName = target.constructor.name;

    descriptor.value = async function (this: T, ...args: unknown[]) {
      const logger = this.logger || new LoggerService(serviceName);
      const methodName = `${serviceName}.${propertyKey}`;

      logger.debug(`服务调用开始 - ${methodName}`);
      const startTime = Date.now();

      try {
        const result = (await originalMethod!.apply(
          this,
          args,
        )) as Promise<unknown>;
        const duration = Date.now() - startTime;
        logger.debug(`服务调用成功 - ${methodName}，耗时: ${duration}ms`);
        return result;
      } catch (error: unknown) {
        const duration = Date.now() - startTime;
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const stackTrace = error instanceof Error ? error.stack : undefined;
        logger.error(
          `服务调用异常 - ${methodName}，耗时: ${duration}ms，错误: ${errorMessage}`,
          stackTrace,
        );
        throw error;
      }
    };

    return descriptor;
  };
}
