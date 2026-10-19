import { dataDirectory, assert } from './provider.mjs';
import { resolve } from 'node:path';
import { prepareRelease, saveReport, ownRepository, inspectRepository } from './release.mjs';
export async function build() { const evidence = await inspectRepository({ repo: ownRepository, includeWorkingTree: true }); return { files: evidence.changedFiles.length }; }
export function featureState() { return { noIndex: true, releaseForm: true }; }
export async function run(provider, body) {
  assert(typeof body.question === 'string' && body.question.trim() && body.question.length <= 3000, 'Введите цель до 3000 символов.');
  // Browser prepares only the local AI Tutors checkout. Portable arbitrary paths use CLI.
  const report = await prepareRelease(provider, { repo: ownRepository, includeWorkingTree: true, runChecks: Boolean(body.runChecks), question: body.question });
  await saveReport(report, resolve(dataDirectory(), 'day-35-reports')); return report;
}
