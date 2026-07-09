import { LoggerService } from './logger.service';

// 全局服务调用序号计数，每次 LogServiceCall 调用时自增，保证同一次调用三处日志使用相同序号
let serviceCallSequence = 0;

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function'
  );
}

function isPromise(value: unknown): value is Promise<unknown> {
  return value instanceof Promise;
}

export function LogAsync() {
  return function (target: object, propertyKey: string, descriptor: TypedPropertyDescriptor<any>) {
    const originalMethod = descriptor.value as (...args: unknown[]) => Promise<unknown> | undefined;
    const className = target.constructor.name;

    descriptor.value = async function (...args: unknown[]): Promise<unknown> {
      const self = this as Record<string, unknown>;
      const logger = (self.logger as LoggerService) || new LoggerService(className);
      const methodName = `${className}.${propertyKey}`;

      logger.debug(`异步操作开始 - ${methodName}`);
      const startTime = Date.now();

      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const result = await (originalMethod?.apply(this, args) ?? Promise.resolve(undefined));
        const duration = Date.now() - startTime;
        logger.debug(`异步操作成功完成 - ${methodName}，耗时: ${duration}ms`);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return result;
      } catch (error: unknown) {
        const duration = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);
        const stackTrace = error instanceof Error ? error.stack : undefined;
        logger.error(`异步操作失败 - ${methodName}，耗时: ${duration}ms，错误: ${errorMessage}`, stackTrace);
        throw error;
      }
    };

    return descriptor;
  };
}

export function LogStep(stepName: string) {
  return function (target: object, propertyKey: string, descriptor: TypedPropertyDescriptor<any>) {
    const originalMethod = descriptor.value as (...args: unknown[]) => unknown;
    const className = target.constructor.name;

    descriptor.value = function (...args: unknown[]): unknown {
      const self = this as Record<string, unknown>;
      const logger = (self.logger as LoggerService) || new LoggerService(className);

      logger.debug(`步骤开始 - ${stepName}`);
      const startTime = Date.now();

      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const result = originalMethod?.apply(this, args);
        const duration = Date.now() - startTime;
        logger.debug(`步骤成功完成 - ${stepName}，耗时: ${duration}ms`);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return result;
      } catch (error: unknown) {
        const duration = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);
        const stackTrace = error instanceof Error ? error.stack : undefined;
        logger.error(`步骤执行失败 - ${stepName}，耗时: ${duration}ms，错误: ${errorMessage}`, stackTrace);
        throw error;
      }
    };

    return descriptor;
  };
}

export function LogServiceCall() {
  return function (target: object, propertyKey: string, descriptor: TypedPropertyDescriptor<any>) {
    const originalMethod = descriptor.value as ((...args: unknown[]) => unknown) | undefined;
    const serviceName = target.constructor.name;

    descriptor.value = function (...args: unknown[]): unknown {
      const self = this as Record<string, unknown>;
      const logger = (self.logger as LoggerService) || new LoggerService(serviceName);
      const methodName = `${serviceName}.${propertyKey}`;

      const seq = ++serviceCallSequence;
      logger.debug(`序号:${seq} 服务调用开始 - ${methodName}`);
      const startTime = Date.now();

      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const result = originalMethod?.apply(this, args);

        if (isAsyncIterable(result)) {
          return (async function* () {
            try {
              for await (const item of result) {
                yield item;
              }

              const duration = Date.now() - startTime;
              logger.debug(`序号:${seq} 服务调用成功 - ${methodName}，耗时: ${duration}ms`);
            } catch (error: unknown) {
              const duration = Date.now() - startTime;
              const errorMessage = error instanceof Error ? error.message : String(error);
              const stackTrace = error instanceof Error ? error.stack : undefined;
              logger.error(
                `序号:${seq} 服务调用异常 - ${methodName}，耗时: ${duration}ms，错误: ${errorMessage}`,
                stackTrace,
              );
              throw error;
            }
          })();
        }

        if (isPromise(result)) {
          return result
            .then((value) => {
              const duration = Date.now() - startTime;
              logger.debug(`序号:${seq} 服务调用成功 - ${methodName}，耗时: ${duration}ms`);
              return value;
            })
            .catch((error: unknown) => {
              const duration = Date.now() - startTime;
              const errorMessage = error instanceof Error ? error.message : String(error);
              const stackTrace = error instanceof Error ? error.stack : undefined;
              logger.error(
                `序号:${seq} 服务调用异常 - ${methodName}，耗时: ${duration}ms，错误: ${errorMessage}`,
                stackTrace,
              );
              throw error;
            });
        }

        const duration = Date.now() - startTime;
        logger.debug(`序号:${seq} 服务调用成功 - ${methodName}，耗时: ${duration}ms`);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return result;
      } catch (error: unknown) {
        const duration = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);
        const stackTrace = error instanceof Error ? error.stack : undefined;
        logger.error(
          `序号:${seq} 服务调用异常 - ${methodName}，耗时: ${duration}ms，错误: ${errorMessage}`,
          stackTrace,
        );
        throw error;
      }
    };

    return descriptor;
  };
}
