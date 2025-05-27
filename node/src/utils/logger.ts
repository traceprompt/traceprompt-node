import winston from "winston";
import { ConfigManager } from "../config";

export type LogLevel =
  | "error"
  | "warn"
  | "info"
  | "verbose"
  | "debug"
  | "silly";

let logger: winston.Logger | null = null;

function createLogger(): winston.Logger {
  const cfg = ConfigManager.cfg;
  const logLevel = cfg.logLevel || "verbose"; // Default to verbose as requested

  return winston.createLogger({
    level: logLevel,
    format: winston.format.combine(
      winston.format.timestamp({
        format: "YYYY-MM-DD HH:mm:ss",
      }),
      winston.format.errors({ stack: true }),
      winston.format.printf(({ level, message, timestamp, stack }) => {
        const prefix = `[${timestamp}] [TracePrompt] [${level.toUpperCase()}]`;
        if (stack) {
          return `${prefix} ${message}\n${stack}`;
        }
        return `${prefix} ${message}`;
      })
    ),
    transports: [
      new winston.transports.Console({
        handleExceptions: true,
        handleRejections: true,
      }),
    ],
    exitOnError: false,
  });
}

function getLogger(): winston.Logger {
  if (!logger) {
    logger = createLogger();
  }
  return logger;
}

export const log = {
  error: (message: string, meta?: any) => getLogger().error(message, meta),
  warn: (message: string, meta?: any) => getLogger().warn(message, meta),
  info: (message: string, meta?: any) => getLogger().info(message, meta),
  verbose: (message: string, meta?: any) => getLogger().verbose(message, meta),
  debug: (message: string, meta?: any) => getLogger().debug(message, meta),
  silly: (message: string, meta?: any) => getLogger().silly(message, meta),
};

export function resetLogger(): void {
  logger = null;
}
