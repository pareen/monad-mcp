type Level = "trace" | "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<Level, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
};

export interface Logger {
  trace: (msg: string, fields?: Record<string, unknown>) => void;
  debug: (msg: string, fields?: Record<string, unknown>) => void;
  info: (msg: string, fields?: Record<string, unknown>) => void;
  warn: (msg: string, fields?: Record<string, unknown>) => void;
  error: (msg: string, fields?: Record<string, unknown>) => void;
  child: (fields: Record<string, unknown>) => Logger;
}

export function createLogger(level: Level = "info", base: Record<string, unknown> = {}): Logger {
  const threshold = LEVEL_RANK[level];
  const emit = (lvl: Level, msg: string, fields?: Record<string, unknown>) => {
    if (LEVEL_RANK[lvl] < threshold) return;
    const line = {
      ts: new Date().toISOString(),
      level: lvl,
      msg,
      ...base,
      ...(fields ?? {}),
    };
    const out = lvl === "error" || lvl === "warn" ? process.stderr : process.stderr;
    out.write(`${JSON.stringify(line)}\n`);
  };

  return {
    trace: (msg, fields) => emit("trace", msg, fields),
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
    child: (fields) => createLogger(level, { ...base, ...fields }),
  };
}
