import { mkdtemp, writeFile, rm, open as fsOpen } from 'fs/promises';
import os from 'os';
import path from 'path';
import { FileHandler } from '../files/FileHandler.js';
import { SendFileTool } from './SendFileTool.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function runTests(): Promise<void> {
  console.log('SendFileTool tests...\n');

  const ws = await mkdtemp(path.join(os.tmpdir(), 'enzo-send-'));
  try {
    const fh = new FileHandler({ workspacePath: ws });
    await writeFile(path.join(ws, 'ok.txt'), 'hello', 'utf8');

    let capturedPayload: { chatId: string; buffer: Buffer; filename: string } | null = null;
    const sendFn = async (chatId: string, buffer: Buffer, filename: string): Promise<void> => {
      capturedPayload = { chatId, buffer, filename };
    };

    const tool = new SendFileTool(sendFn, fh, ws);
    let out = await tool.execute({
      path: 'ok.txt',
      telegramChatId: '777',
    });
    assert(out.success === true, 'exist success flag');
    assert(String(out.data ?? '').includes('ok.txt'), 'confirmation mentions file');
    const captured1 = capturedPayload!;
    assert(captured1.chatId === '777', 'chat id forwarded');
    assert(captured1.filename === 'ok.txt', 'filename basename');
    assert(captured1.buffer.toString('utf8') === 'hello', 'buffer match');

    out = await tool.execute({
      path: 'missing.bin',
      telegramChatId: '777',
    });
    assert(out.success === false, 'missing file fails');
    assert(String(out.error ?? '').includes('No encontré el archivo'), 'missing file message');

    const hugePath = path.join(ws, 'huge.bin');
    const h = await fsOpen(hugePath, 'w');
    await h.truncate(51 * 1024 * 1024 + 1);
    await h.close();

    out = await tool.execute({
      path: 'huge.bin',
      telegramChatId: '777',
    });
    assert(out.success === false, 'oversize fails');
    assert(String(out.error ?? '').includes('50MB'), 'oversize mentions limit');

    const absPath = path.join(ws, 'abs.txt');
    await writeFile(absPath, 'abs', 'utf8');
    let capturedAbs: { chatId: string } | null = null;
    const sendFnAbs = async (chatId: string, buffer: Buffer, filename: string): Promise<void> => {
      capturedAbs = { chatId };
    };
    const toolAbs = new SendFileTool(sendFnAbs, fh, ws);
    const outAbs = await toolAbs.execute({
      path: absPath,
      telegramChatId: '99',
    });
    assert(outAbs.success === true, 'absolute exec success');
    const capturedForAbs = capturedAbs as { chatId: string } | null;
    assert(capturedForAbs !== null && capturedForAbs.chatId === '99', 'absolute path resolves');

    const noInject = await tool.execute({
      path: 'ok.txt',
    });
    assert(noInject.success === false, 'telegram only without chat id');

    console.log('SendFileTool tests: OK');
  } finally {
    await rm(ws, { recursive: true, force: true }).catch(() => {});
  }
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
