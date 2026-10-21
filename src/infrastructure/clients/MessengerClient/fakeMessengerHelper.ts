// A stand-in for huginn-messenger, run as a real child process by MessengerClient.test.ts:
// it answers info, login and connect the way the helper does, pushes one message after
// connecting, and notes what happened in $FAKE_MESSENGER_LOG. Cookies with xs "dead" are
// refused; with FAKE_MESSENGER_CRASH=1 its first connected run dies, as a crash would.
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';

const logFile = process.env.FAKE_MESSENGER_LOG ?? '/dev/null';
const crashedBefore = `${logFile}.crashed`;
const note = (line: string) => appendFileSync(logFile, `${line}\n`);
const write = (message: object) => process.stdout.write(`${JSON.stringify(message)}\n`);
const ACCOUNT = { userId: '100000001', name: 'Jozef' };

note(`start ${process.argv.slice(2).join(' ')}`);
process.stderr.write(`${JSON.stringify({ level: 'info', message: 'helper up' })}\n`);

for await (const line of console) {
  if (line.trim() === '') {
    continue;
  }

  const request = JSON.parse(line) as {
    id: number;
    method: string;
    params: { cookies?: Record<string, string> };
  };

  note(`call ${request.method} ${JSON.stringify(request.params)}`);

  if (request.method === 'info') {
    write({ id: request.id, result: { userAgent: 'Mozilla/5.0 (fake) Chrome/141' } });
  } else if (request.params.cookies?.xs === 'dead') {
    write({ id: request.id, error: { code: 'Unauthorized', message: 'The session has ended' } });
  } else if (request.method === 'login') {
    write({
      id: request.id,
      result: { ...ACCOUNT, cookies: { ...request.params.cookies, fr: 'fr-1' } },
    });
  } else if (request.method === 'connect') {
    write({ id: request.id, result: ACCOUNT });
    write({ event: { type: 'connected' } });
    write({ event: { type: 'something-new', at: 1 } });
    write({
      event: {
        type: 'message',
        id: 'mid.1',
        threadId: '100000002',
        encrypted: true,
        isGroup: false,
        threadName: null,
        senderId: '100000002',
        senderName: 'Petra',
        fromMe: false,
        text: 'Hi',
        timestamp: 1761066000000,
        replyToId: null,
        url: 'https://www.facebook.com/messages/e2ee/t/100000002',
        initial: true,
      },
    });
    write({ event: { type: 'cookies', cookies: { ...request.params.cookies, xs: 'xs-2' } } });

    if (process.env.FAKE_MESSENGER_CRASH === '1' && !existsSync(crashedBefore)) {
      writeFileSync(crashedBefore, '');
      process.exit(3);
    }
  } else {
    write({ id: request.id, error: { code: 'Validation', message: `unknown ${request.method}` } });
  }
}

note('stdin closed');
