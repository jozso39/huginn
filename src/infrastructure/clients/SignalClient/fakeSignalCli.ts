// A stand-in for `signal-cli jsonRpc`, run as a real child process by SignalClient.test.ts:
// it answers the methods Huginn uses, pushes one message per subscription the way a
// manual subscription does, and notes what happened in $FAKE_SIGNAL_LOG. With
// FAKE_SIGNAL_CRASH=1 its first run dies right after that message, as a crash would.
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';

const ACCOUNT = '+420600000001';
const logFile = process.env.FAKE_SIGNAL_LOG ?? '/dev/null';
const crashedBefore = `${logFile}.crashed`;
const note = (line: string) => appendFileSync(logFile, `${line}\n`);
const write = (message: object) => process.stdout.write(`${JSON.stringify(message)}\n`);
const results: Record<string, unknown> = {
  listAccounts: [{ number: ACCOUNT }],
  unsubscribeReceive: true,
  send: { timestamp: 1759046500000 },
  startLink: { deviceLinkUri: 'sgnl://linkdevice?uuid=fake' },
  finishLink: { number: ACCOUNT },
};

note(`start ${process.argv.slice(2).join(' ')}`);
process.on('SIGTERM', () => {
  note('sigterm');
  process.exit(0);
});

let subscriptions = 0;

for await (const line of console) {
  const request = JSON.parse(line) as { id: number; method: string; params: object };

  note(`call ${request.method} ${JSON.stringify(request.params)}`);

  if (request.method === 'subscribeReceive') {
    const subscription = subscriptions++;

    write({ jsonrpc: '2.0', id: request.id, result: subscription });
    write({
      jsonrpc: '2.0',
      method: 'receive',
      params: {
        subscription,
        result: {
          account: ACCOUNT,
          envelope: {
            sourceNumber: '+420600000002',
            sourceName: 'Petra',
            timestamp: 1759046400000 + subscription,
            dataMessage: { timestamp: 1759046400000 + subscription, message: 'Hi' },
          },
        },
      },
    });

    if (process.env.FAKE_SIGNAL_CRASH === '1' && !existsSync(crashedBefore)) {
      writeFileSync(crashedBefore, '');
      process.exit(3);
    }
  } else if (request.method in results) {
    write({ jsonrpc: '2.0', id: request.id, result: results[request.method] });
  } else {
    write({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } });
  }
}

note('stdin closed');
