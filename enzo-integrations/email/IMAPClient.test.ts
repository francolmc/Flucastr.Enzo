/**
 * Uses a fake ctor instead of imapflow (no real servers).
 */

import EventEmitter from 'node:events';
import { ImapFlow } from 'imapflow';
import { IMAPClient } from './IMAPClient.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

class FakeImap extends EventEmitter {
  mode: 'ok' | 'fail_connect' = 'ok';

  authenticated = '';

  mailbox: false | import('imapflow').MailboxObject = false;

  async connect(): Promise<void> {
    if (this.mode === 'fail_connect') {
      throw new Error('ECONNRESET');
    }
    this.authenticated = 'user@test';
  }

  async logout(): Promise<void> {
    this.mailbox = false;
  }

  async mailboxOpen(_path?: string): Promise<import('imapflow').MailboxObject> {
    this.mailbox = {
      path: 'INBOX',
      delimiter: '/',
      flags: new Set(),
      uidValidity: 1n,
      uidNext: 1000,
      exists: 2,
    };
    return this.mailbox;
  }

  async search(_query: Record<string, unknown>): Promise<number[] | false> {
    return [501, 500];
  }

  async *fetch(
    range: string | Iterable<number>,
    _query: object,
    _opts?: object
  ): AsyncGenerator<{
    uid: number;
    envelope: import('imapflow').MessageEnvelopeObject;
    internalDate: Date;
    source?: Buffer;
    bodyStructure?: import('imapflow').MessageStructureObject;
  }> {
    let list: number[];
    if (typeof range === 'string') {
      list = [501, 500];
    } else if (typeof range === 'number') {
      list = [range];
    } else {
      list = [...range];
    }
    for (const uid of list) {
      yield {
        uid,
        envelope: {
          subject: 'Hello',
          from: [{ name: 'A', address: 'a@test.com' }],
          to: [{ address: 'b@test.com' }],
          date: new Date('2026-01-15T10:00:00Z'),
        },
        internalDate: new Date('2026-01-15T10:00:00Z'),
        source: Buffer.from('hello body content for preview'),
      };
    }
  }
}

const FakeImapCtor = FakeImap as unknown as typeof ImapFlow;

class FailingCtor extends FakeImap {
  constructor(opts: unknown) {
    super();
    this.mode = 'fail_connect';
    void opts;
  }
}

const FailingImapCtor = FailingCtor as unknown as typeof ImapFlow;

async function runTests(): Promise<void> {
  console.log('IMAPClient tests...\n');

  console.log('Test: getRecent returns EmailMessage-shaped results');
  const cli = new IMAPClient({
    host: 'imap.test',
    port: 993,
    user: 'u@test',
    password: 'p',
    imapCtor: FakeImapCtor,
  });
  const recent = await cli.getRecent({ folder: 'INBOX', limit: 10 });
  assert(recent.length >= 1, 'expected messages');
  const m = recent[0]!;
  assert(typeof m.subject === 'string', 'subject');
  assert(typeof m.preview === 'string', 'preview');
  assert(m.date instanceof Date, 'date');
  console.log('✓ Pass\n');

  console.log('Test: search returns results');
  const searchRes = await cli.search({
    query: 'cliente',
    limit: 5,
    folder: 'INBOX',
  });
  assert(Array.isArray(searchRes), 'array');
  assert(searchRes.length >= 1, 'one result');
  console.log('✓ Pass\n');

  console.log('Test: testConnection true');
  assert((await cli.testConnection()) === true, 'expect true');
  console.log('✓ Pass\n');

  console.log('Test: testConnection false on connect failure');
  const badCli = new IMAPClient({
    host: 'x',
    port: 993,
    user: 'u',
    password: 'p',
    imapCtor: FailingImapCtor,
  });
  assert((await badCli.testConnection()) === false, 'expect false');
  console.log('✓ Pass\n');

  console.log('Test: diagnose captures error message');
  const diag = await badCli.diagnose();
  assert(!diag.ok && typeof diag.error === 'string', 'diag fail');
  console.log('✓ Pass\n');

  console.log('All IMAPClient tests OK');
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
