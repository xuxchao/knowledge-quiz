import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
  traceId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = {
  run<T>(context: RequestContext, callback: () => T): T {
    return storage.run(context, callback);
  },
  get(): RequestContext | undefined {
    return storage.getStore();
  },
};
