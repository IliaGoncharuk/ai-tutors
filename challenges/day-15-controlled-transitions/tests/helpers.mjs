import { proposalFor } from '../server/invariants.mjs';
import { applyAction, generateWorkflow } from '../server/core.mjs';

export async function answer(context) {
  return {
    text: JSON.stringify(proposalFor(context)),
    model: 'test-provider',
    usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
  };
}

export async function advance(original, target) {
  let state = original;
  const flow = () => state.workflows[state.activeTask];
  if (flow().stage === target) return state;
  if (target === 'execution' && flow().stage === 'validation') return applyAction(state, { type: 'transition', target });
  if (flow().stage === 'planning') {
    if (!flow().plan || flow().planRequirementsVersion !== flow().requirementsVersion) state = (await generateWorkflow(state, { kind: 'plan', mode: 'live' }, answer)).state;
    state = applyAction(state, { type: 'approve-plan', planVersion: flow().planVersion });
    state = applyAction(state, { type: 'transition', target: 'execution' });
  }
  if (target === 'execution') return state;
  if (flow().stage === 'execution') {
    if (!flow().artifact || flow().artifactPlanVersion !== flow().planVersion || flow().artifactRequirementsVersion !== flow().requirementsVersion) state = (await generateWorkflow(state, { kind: 'artifact', mode: 'live' }, answer)).state;
    state = applyAction(state, { type: 'transition', target: 'validation' });
  }
  if (target === 'validation') return state;
  if (target === 'done') {
    state = applyAction(state, { type: 'validate-task' });
    return applyAction(state, { type: 'transition', target: 'done' });
  }
  throw new Error(`Unsupported test target: ${target}`);
}
