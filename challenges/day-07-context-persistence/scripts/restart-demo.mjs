import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function runProcess(script, lines, env = {}, cwd) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(script)], {
      env: { ...process.env, ...env }, cwd, windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), 75_000);
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolveResult({ code, signal, stdout, stderr });
    });
    child.stdin.on('error', () => { /* An early startup failure may close stdin. */ });
    child.stdin.end(`${lines.join('\n')}\n`);
  });
}

export async function verifyRestart({ live = false, write = console.log } = {}) {
  if (live && !process.env.OPENAI_API_KEY?.trim()) {
    throw new Error('Для двух реальных API-вызовов нужен OPENAI_API_KEY.');
  }
  const directory = mkdtempSync(join(tmpdir(), 'ai-tutors-day07-demo-'));
  const file = join(directory, 'messages.json');
  const word = `context-${randomUUID()}`;
  const script = new URL(live ? '../cli.mjs' : './offline-cli.mjs', import.meta.url);
  const env = {
    AGENT_HISTORY_FILE: file,
    ...(live ? {} : { OPENAI_API_KEY: '' }),
  };
  write(live ? 'Реальная проверка: два вызова OpenAI API.' : 'Локальная проверка: поддельный LLM-клиент, без API.');
  try {
    const first = await runProcess(script, [
      `Проверочное слово: ${word}. Запомни его для следующего сообщения. Ответь кратко.`,
      '/exit',
    ], env);
    assert.equal(first.code, 0, first.stderr || 'Первый процесс завершился с ошибкой.');
    assert.equal(first.stderr, '');
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(saved.messages.length, 2);
    write(`Первый процесс завершён. В JSON: ${saved.messages.length} сообщения.`);
    write(first.stdout.trim());

    // Start a fresh process, even from another working directory.
    const second = await runProcess(script, [
      'Какое проверочное слово я просил запомнить? Ответь только этим словом.',
      '/exit',
    ], env, directory);
    assert.equal(second.code, 0, second.stderr || 'Второй процесс завершился с ошибкой.');
    assert.equal(second.stderr, '');
    assert.match(second.stdout, /Восстановлено сообщений: 2/);
    const restored = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(restored.messages.slice(0, 2), saved.messages);
    assert.equal(restored.messages.length, 4);
    assert.ok(restored.messages[3].content.includes(word), 'Ответ после перезапуска должен содержать проверочное слово.');
    write('Второй процесс восстановил диалог:');
    write(second.stdout.trim());
    write('Проверка пройдена: слово восстановлено, в JSON 4 сообщения.');
  } finally {
    // Only remove the dedicated temporary directory created by this run.
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(directory.startsWith(join(tmpdir(), 'ai-tutors-day07-demo-')));
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await verifyRestart({ live: process.argv.includes('--live') });
  } catch {
    console.error('Проверка перезапуска не пройдена. Проверьте настройки, доступ к файлу и API.');
    process.exitCode = 1;
  }
}
