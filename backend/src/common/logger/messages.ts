export const LOG_MESSAGES = {
  async: {
    start: (methodName: string) => `异步操作开始 - ${methodName}`,
    success: (methodName: string, duration: number) =>
      `异步操作成功完成 - ${methodName}，耗时: ${duration}ms`,
    failure: (methodName: string, error: string) =>
      `异步操作失败 - ${methodName}，错误: ${error}`,
  },
  step: {
    start: (stepName: string) => `步骤开始 - ${stepName}`,
    success: (stepName: string, duration: number) =>
      `步骤成功完成 - ${stepName}，耗时: ${duration}ms`,
    failure: (stepName: string, error: string) =>
      `步骤执行失败 - ${stepName}，错误: ${error}`,
  },
  service: {
    call: (serviceName: string, methodName: string) =>
      `服务调用 - ${serviceName}.${methodName}`,
    return: (serviceName: string, methodName: string) =>
      `服务返回 - ${serviceName}.${methodName}`,
    error: (serviceName: string, methodName: string, error: string) =>
      `服务调用异常 - ${serviceName}.${methodName}，错误: ${error}`,
  },
  controller: {
    request: (controllerName: string, methodName: string) =>
      `请求进入 - ${controllerName}.${methodName}`,
    response: (controllerName: string, methodName: string, status: number) =>
      `请求响应 - ${controllerName}.${methodName}，状态码: ${status}`,
    error: (controllerName: string, methodName: string, error: string) =>
      `请求处理异常 - ${controllerName}.${methodName}，错误: ${error}`,
  },
  module: {
    enabled: (moduleName: string) => `模块日志已启用 - ${moduleName}`,
    disabled: (moduleName: string) => `模块日志已禁用 - ${moduleName}`,
    levelChanged: (moduleName: string, level: string) =>
      `模块日志级别已更改 - ${moduleName}，新级别: ${level}`,
  },
};

export const LOG_LEVEL_DESCRIPTIONS = {
  DEBUG: '调试',
  INFO: '信息',
  WARN: '警告',
  ERROR: '错误',
};

export const LOG_OUTPUT_FORMATS = {
  CONSOLE: 'console',
  JSON: 'json',
};