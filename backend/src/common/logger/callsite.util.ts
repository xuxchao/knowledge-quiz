export interface CallSiteInfo {
  fileName: string;
  lineNumber: number;
  columnNumber: number;
  functionName: string;
  methodName: string;
}

export function getCallSiteInfo(skipFrames: number = 3): CallSiteInfo {
  const originalPrepareStackTrace = Error.prepareStackTrace;
  
  try {
    Error.prepareStackTrace = (_, stack) => stack;
    const error = new Error();
    const stack = error.stack as unknown as NodeJS.CallSite[];
    
    const frame = stack?.[skipFrames];
    if (!frame) {
      return {
        fileName: 'unknown',
        lineNumber: 0,
        columnNumber: 0,
        functionName: 'unknown',
        methodName: 'unknown',
      };
    }
    
    const fileName = frame.getFileName() || 'unknown';
    const functionName = frame.getFunctionName() || 'unknown';
    const methodName = frame.getMethodName() || 'unknown';
    
    return {
      fileName: fileName.split('/').pop() || fileName,
      lineNumber: frame.getLineNumber() || 0,
      columnNumber: frame.getColumnNumber() || 0,
      functionName,
      methodName,
    };
  } finally {
    Error.prepareStackTrace = originalPrepareStackTrace;
  }
}