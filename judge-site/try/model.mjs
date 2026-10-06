export const EVENT_LABELS = Object.freeze({
  page_view: 'Recorded visit',
  mission_started: 'Started exploring',
  problem_selected: 'Chose a problem and audience',
  brief_created: 'Created an experiment brief',
  price_signal_submitted: 'Shared a price preference',
  brief_copied: 'Copied a brief successfully',
  brief_exported: 'Requested a brief export',
});
const ownKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const integer = (value, max) => Number.isInteger(value) && value >= 0 && value <= max;
export function readSummary(event, { origin, source }) {
  if (event.origin !== origin || event.source !== source || !source) return null;
  const value = event.data;
  if (!ownKeys(value, ['source','version','mode','scope','consent','recordedSessions','briefsCreated','feedbackResponses','eventCounts'])
    || value.source !== 'launchlab-judge-sample' || value.version !== 1
    || value.mode !== 'browser-local' || value.scope !== 'current-page-visit'
    || typeof value.consent !== 'boolean' || !integer(value.recordedSessions, 1)
    || !integer(value.briefsCreated, 400) || !integer(value.feedbackResponses, 1)
    || !Array.isArray(value.eventCounts) || value.eventCounts.length !== Object.keys(EVENT_LABELS).length) return null;
  const ids = new Set();
  let total = 0;
  for (const row of value.eventCounts) {
    if (!ownKeys(row, ['id','occurrences','sessions']) || !Object.hasOwn(EVENT_LABELS, row.id)
      || ids.has(row.id) || !integer(row.occurrences, 400) || !integer(row.sessions, 1)
      || row.sessions !== (row.occurrences > 0 ? 1 : 0)) return null;
    ids.add(row.id); total += row.occurrences;
  }
  const visit = value.eventCounts.find(row => row.id === 'page_view');
  const briefs = value.eventCounts.find(row => row.id === 'brief_created');
  if (total > 400 || visit.occurrences > 1 || value.recordedSessions !== (total > 0 ? 1 : 0)
    || briefs.occurrences !== value.briefsCreated) return null;
  return { ...value, eventCounts: value.eventCounts.map(row => ({ ...row })) };
}
export function emptySummary() {
  return { consent: false, recordedSessions: 0, briefsCreated: 0, feedbackResponses: 0,
    eventCounts: Object.keys(EVENT_LABELS).map(id => ({ id, occurrences: 0, sessions: 0 })) };
}
export function reportText(summary) {
  return ['LaunchLab — browser demo observations', 'Dev Day Pulse · this page visit only', '',
    `Activity recording: ${summary.consent ? 'allowed' : 'off'}`,
    `Recorded browser visits: ${summary.recordedSessions}`,
    `Brief creation actions: ${summary.briefsCreated}`,
    `Feedback responses: ${summary.feedbackResponses}`, '',
    ...summary.eventCounts.map(row => `${EVENT_LABELS[row.id]}: ${row.occurrences}`), '',
    'These are local rehearsal actions, not verified people or customer demand.',
    'Price preferences are nonbinding. Export counts are requests, not saved-file proof.',
    'No paid OKX task, model call or new managed deployment was run by this demo.',
    'No feedback text, form answers or personal identifiers are included.', ''].join('\n');
}
