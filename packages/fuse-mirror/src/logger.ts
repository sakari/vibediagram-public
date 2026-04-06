export interface Logger {
  info(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

export const consoleLogger: Logger = {
  info(message, ...args) {
    console.log(message, ...args);
  },
  debug(message, ...args) {
    console.debug(message, ...args);
  },
};

export const silentLogger: Logger = {
  info() {},
  debug() {},
};
