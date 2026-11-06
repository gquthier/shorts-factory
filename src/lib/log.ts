type Ctx = { name: string } & Record<string, unknown>;
const write = (level: string, ctx: Ctx, msg: string) =>
  process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), level, msg, ...ctx })}\n`);
export const log = {
  info: (ctx: Ctx, msg: string) => write('info', ctx, msg),
  warn: (ctx: Ctx, msg: string) => write('warn', ctx, msg),
  error: (ctx: Ctx, msg: string) => write('error', ctx, msg),
};
