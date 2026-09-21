import { proposalFor } from '../server/invariants.mjs';

export async function answer(context) {
  return {
    text: JSON.stringify(proposalFor(context)),
    model: 'test-provider',
    usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
  };
}
