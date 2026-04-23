export interface AmplifierLoopLog {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export function createDefaultAmplifierLoopLog(): AmplifierLoopLog {
  return {
    debug: (...a) => console.log(...a),
    info: (...a) => console.log(...a),
    warn: (...a) => console.warn(...a),
    error: (...a) => console.error(...a),
  };
}
