import { logger as triggerLogger } from '@trigger.dev/sdk';

export type LogContext = {
  traceId?: string;
  chatId?: string;
  runId?: string;
  messageId?: string;
  [key: string]: unknown;
};

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

let preferTrigger = false;

/** Prefer Trigger.dev's logger (call from inside tasks). */
export function useTriggerLogger(enabled = true): void {
  preferTrigger = enabled;
}

function emit(level: LogLevel, message: string, fields: LogContext): void {
  if (preferTrigger) {
    const fn = triggerLogger[level] ?? triggerLogger.info;
    fn.call(triggerLogger, message, fields);
    return;
  }

  const line = JSON.stringify({
    level,
    msg: message,
    ts: new Date().toISOString(),
    ...fields,
  });

  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export type Logger = {
  child(extra: LogContext): Logger;
  debug(message: string, fields?: LogContext): void;
  info(message: string, fields?: LogContext): void;
  warn(message: string, fields?: LogContext): void;
  error(message: string, fields?: LogContext): void;
};

export function createLogger(base: LogContext = {}): Logger {
  return {
    child(extra) {
      return createLogger({ ...base, ...extra });
    },
    debug(message, fields) {
      emit('debug', message, { ...base, ...fields });
    },
    info(message, fields) {
      emit('info', message, { ...base, ...fields });
    },
    warn(message, fields) {
      emit('warn', message, { ...base, ...fields });
    },
    error(message, fields) {
      emit('error', message, { ...base, ...fields });
    },
  };
}

export const log = createLogger();
