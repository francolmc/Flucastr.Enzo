import { ReadEmailTool } from './ReadEmailTool.js';
import type { EmailMessage } from '../email/IMAPClient.js';
import type { EmailService } from '../email/EmailService.js';
import type { EmailQuery, EmailServiceResult } from '../email/EmailService.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function stubEmailService(impl: {
  configured: number;
  getRecent: (opts?: EmailQuery) => Promise<EmailServiceResult>;
}): EmailService {
  return {
    getConfiguredAccounts() {
      return Array.from({ length: impl.configured }).map((_, i) => ({
        id: `a${i}`,
        label: `L${i}`,
        imap: { host: 'h', port: 993, user: 'u' },
        enabled: true,
      }));
    },
    getRecent: impl.getRecent,
  } as unknown as EmailService;
}

async function runTests(): Promise<void> {
  console.log('ReadEmailTool tests...\n');

  console.log('Test: no accounts → friendly message');
  const t0 = new ReadEmailTool(stubEmailService({ configured: 0, getRecent: async () => ({ success: true }) }));
  const out0 = await t0.execute({}, {});
  assert(
    out0.success === true &&
      String((out0.data as { formatted?: string })?.formatted ?? '').includes(
        'No hay cuentas de email configuradas'
      ),
    'friendly'
  );
  console.log('✓ Pass\n');

  console.log('Test: since today maps to start of day');
  const recentTimes: Date[] = [];
  const t1 = new ReadEmailTool(
    stubEmailService({
      configured: 1,
      getRecent: async (opts?) => {
        if (opts?.since) recentTimes.push(opts.since);
        return {
          success: true,
          messages: [],
        };
      },
    })
  );
  const r1 = await t1.execute({ since: 'today' }, {});
  assert(r1.success === true, 'ok');
  assert(recentTimes.length === 1, 'since passed');
  const s0 = recentTimes[0]!;
  assert(s0.getHours() === 0 && s0.getMinutes() === 0, 'midnight start');
  console.log('✓ Pass\n');

  console.log('Test: with emails → formatted output');
  const sample: EmailMessage = {
    id: '1',
    subject: 'Propuesta proyecto',
    from: 'cliente@empresa.com',
    to: [],
    date: new Date(),
    preview: 'Hola Franco, adjunto la propuesta…',
    hasAttachments: false,
    folder: 'INBOX',
  };
  const t2 = new ReadEmailTool(
    stubEmailService({
      configured: 1,
      getRecent: async () => ({
        success: true,
        messages: [sample],
      }),
    })
  );
  const r2 = await t2.execute({ accountId: 'a0', limit: 10 }, {});
  assert(r2.success === true, 'ok2');
  const fmt = (r2.data as { formatted: string }).formatted;
  assert(fmt.includes('📧'), 'emoji');
  assert(fmt.includes('Propuesta proyecto'), 'subject');
  assert(fmt.includes('cliente@empresa.com'), 'from');
  console.log('✓ Pass\n');

  console.log('All ReadEmailTool tests OK');
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
