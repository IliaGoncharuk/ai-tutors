import { writeFile, mkdir, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Provider } from '../server/provider.mjs';
import { commitInput, buildCiIndex, review, reportMarkdown } from '../server/review.mjs';
const provider = new Provider();
try {
  const input = await commitInput(process.env.PR_BASE_SHA || '', process.env.PR_HEAD_SHA || '');
  await buildCiIndex(provider, input.files); const report = await review(provider, input);
  const directory = resolve(process.env.REVIEW_OUTPUT_DIR || 'review-output'); await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'review.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(resolve(directory, 'review.md'), reportMarkdown(report));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, reportMarkdown(report));
  console.log(JSON.stringify({ findings: report.findings.length, budget: provider.budget() }));
} finally { provider.close(); }
