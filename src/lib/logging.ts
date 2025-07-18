import pino from 'pino';
import pretty from 'pino-pretty';

// const stream = pretty({
//   colorize: true,
//   crlf: false,
//   levelFirst: false,
//   ignore: 'hostname',
// });

// export const log = pino(
//   {
//     name: process.env.APP_LOG_PREFIX ?? 'IA-SCREENSHOTS',
//     level: process.env.APP_LOG_LEVEL ?? 'info',
//     timestamp: pino.stdTimeFunctions.isoTime,
//   },
//   stream
// );

const transport = pino.transport({
  target: 'pino-pretty',
  options: {
    colorize: true,
    crlf: false,
    levelFirst: true,
    ignore: 'hostname',
  },
});

export const log = pino(
  {
    name: process.env.APP_LOG_PREFIX ?? 'IA-SCREENSHOTS',
    level: process.env.APP_LOG_LEVEL ?? 'info',
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  transport
);
