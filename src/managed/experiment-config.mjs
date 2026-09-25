export function publicExperiment(run) {
  const plan = run.instrumentation;
  if (!plan) return null;
  return { id: plan.id, sourceCommit: run.source.commitSha, digest: run.input.experimentDigest,
    events: plan.design.events.map(({ id, label }) => ({ id, label })), funnel: plan.design.funnel,
    questions: plan.design.questions, limitations: plan.design.limitations };
}
