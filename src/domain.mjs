import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { id, now, event, requireThat } from './store.mjs';

const text = (min, max) => z.string().trim().min(min).max(max);
const campaignInput = z
  .object({
    releaseId: text(1, 80),
    title: text(3, 100),
    audience: text(3, 250),
    task: text(10, 1500),
    budget: z.number().int().min(1).max(100000),
    reward: z.number().int().min(1).max(10000),
  })
  .strict();
const feedbackInput = z
  .object({
    outcome: z.enum(['completed', 'blocked']),
    steps: text(20, 3000),
    observation: text(20, 3000),
    suggestion: text(0, 1500).default(''),
    rating: z.number().int().min(1).max(5),
  })
  .strict();
const hashToken = (value) => createHash('sha256').update(value).digest('hex');
const find = (list, value, kind) => {
  const item = list.find((x) => x.id === value);
  requireThat(item, `${kind} not found`, 404);
  return item;
};
function expire(state) {
  for (const r of state.reservations)
    if (r.status === 'reserved' && Date.parse(r.expiresAt) <= Date.now()) r.status = 'expired';
}
export function pool(state, campaign) {
  const reserved = state.reservations
    .filter(
      (r) =>
        r.campaignId === campaign.id &&
        ['reserved', 'submitted'].includes(r.status) &&
        (r.status === 'submitted' || Date.parse(r.expiresAt) > Date.now()),
    )
    .reduce((n, r) => n + r.reward, 0);
  const awarded = state.ledger
    .filter((r) => r.campaignId === campaign.id)
    .reduce((n, r) => n + r.amount, 0);
  return {
    budget: campaign.budget,
    reserved,
    awarded,
    available: campaign.budget - reserved - awarded,
    unit: 'demo credits',
  };
}
export function addProjectRecord(state, snapshot) {
  const project = {
    id: id('prj'),
    name: snapshot.manifest.name,
    description: snapshot.manifest.description,
    sourceKind: snapshot.kind,
    repoUrl: snapshot.repoUrl,
    commitSha: snapshot.commitSha,
    sourceDigest: snapshot.digest,
    manifest: snapshot.manifest,
    createdAt: now(),
  };
  state.projects.unshift(project);
  event(
    state,
    'project.imported',
    project.id,
    snapshot.commitSha
      ? `Pinned Git commit ${snapshot.commitSha}`
      : `Bundled source snapshot ${snapshot.digest.slice(0, 12)}`,
  );
  return project;
}

export function addReleaseRecord(state, projectId, values) {
  const project = find(state.projects, projectId, 'Project');
  const release = {
    id: id('rel'),
    projectId,
    ...values,
    commitSha: project.commitSha,
    sourceDigest: project.sourceDigest,
    createdAt: now(),
    status: 'preparing',
    checks: [],
  };
  state.releases.unshift(release);
  event(state, 'release.preparing', release.id, 'Preparing an immutable static preview');
  return release;
}

export function createCampaignRecord(state, input) {
  const parsed = campaignInput.parse(input);
  requireThat(parsed.reward <= parsed.budget, 'Reward cannot exceed the pool.');
  const release = find(state.releases, parsed.releaseId, 'Release');
  requireThat(
    release.status === 'ready',
    'A verified preview is required before recruiting testers.',
    409,
  );
  const campaign = {
    ...parsed,
    id: id('cmp'),
    projectId: release.projectId,
    createdAt: now(),
    status: 'open',
    settlement: 'demo_credits',
    reviewPolicy:
      'Honest completion or a documented blocker is eligible. Sentiment and rating do not affect rewards.',
  };
  state.campaigns.unshift(campaign);
  event(
    state,
    'campaign.opened',
    campaign.id,
    `${campaign.budget} demo credits allocated; ${campaign.reward} per accepted submission`,
  );
  return { ...campaign, pool: pool(state, campaign) };
}

export class Domain {
  constructor(store) {
    this.store = store;
  }
  overview() {
    return this.store.change((state) => {
      expire(state);
      return {
        ...state,
        reservations: state.reservations.map(({ tokenHash, ...r }) => r),
        campaigns: state.campaigns.map((c) => ({ ...c, pool: pool(state, c) })),
      };
    });
  }
  addProject(snapshot) {
    return this.store.change((state) => addProjectRecord(state, snapshot));
  }
  addRelease(projectId, values) {
    return this.store.change((state) => addReleaseRecord(state, projectId, values));
  }
  finishRelease(releaseId, values) {
    return this.store.change((state) => {
      const release = find(state.releases, releaseId, 'Release');
      requireThat(release.status === 'preparing', 'Release is already finalized.', 409);
      Object.assign(release, values, { checkedAt: now() });
      event(
        state,
        `release.${release.status}`,
        release.id,
        release.status === 'ready'
          ? 'Static snapshot served and HTTP probe passed. Local trial readiness only.'
          : 'Readiness checks failed.',
      );
      return release;
    });
  }
  createCampaign(input) {
    return this.store.change((state) => createCampaignRecord(state, input));
  }
  reserve(campaignId, participantId) {
    const participant = text(3, 100).parse(participantId).toLowerCase();
    return this.store.change((state) => {
      expire(state);
      const campaign = find(state.campaigns, campaignId, 'Campaign');
      requireThat(campaign.status === 'open', 'Campaign is closed.', 409);
      requireThat(
        !state.reservations.some(
          (r) =>
            r.campaignId === campaignId &&
            r.participantId === participant &&
            r.status !== 'expired',
        ),
        'This participant already has a reservation. Keep the original session token.',
        409,
      );
      requireThat(
        pool(state, campaign).available >= campaign.reward,
        'All reward slots are reserved or awarded.',
        409,
      );
      const token = randomBytes(32).toString('hex');
      const reservation = {
        id: id('res'),
        campaignId,
        releaseId: campaign.releaseId,
        participantId: participant,
        reward: campaign.reward,
        status: 'reserved',
        tokenHash: hashToken(token),
        createdAt: now(),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      };
      state.reservations.push(reservation);
      event(
        state,
        'session.reserved',
        reservation.id,
        `${campaign.reward} demo credits held for 30 minutes`,
      );
      const { tokenHash, ...publicReservation } = reservation;
      return { ...publicReservation, token };
    });
  }
  submit(reservationId, token, input) {
    const parsed = feedbackInput.parse(input);
    return this.store.change((state) => {
      expire(state);
      const reservation = find(state.reservations, reservationId, 'Reservation');
      requireThat(
        typeof token === 'string' && hashToken(token) === reservation.tokenHash,
        'Invalid session token',
        403,
      );
      requireThat(
        reservation.status === 'reserved',
        'This reservation expired or was already submitted.',
        409,
      );
      const release = find(state.releases, reservation.releaseId, 'Release');
      const feedback = {
        id: id('fb'),
        reservationId,
        campaignId: reservation.campaignId,
        releaseId: release.id,
        sourceDigest: release.sourceDigest,
        commitSha: release.commitSha,
        previewUrl: release.previewUrl,
        ...parsed,
        createdAt: now(),
        status: 'pending',
        review: null,
      };
      state.feedback.unshift(feedback);
      reservation.status = 'submitted';
      event(
        state,
        'feedback.submitted',
        feedback.id,
        `${parsed.outcome}; awaiting evidence review`,
      );
      return feedback;
    });
  }
  review(feedbackId, decision, reason) {
    z.enum(['accept', 'reject']).parse(decision);
    text(10, 1000).parse(reason);
    return this.store.change((state) => {
      const feedback = find(state.feedback, feedbackId, 'Feedback');
      if (feedback.status !== 'pending') {
        requireThat(
          feedback.status === (decision === 'accept' ? 'accepted' : 'rejected'),
          'A different review decision was already recorded.',
          409,
        );
        return feedback;
      }
      const reservation = find(state.reservations, feedback.reservationId, 'Reservation');
      feedback.status = decision === 'accept' ? 'accepted' : 'rejected';
      feedback.review = { reason, at: now(), reviewer: 'local-operator-or-authorized-agent' };
      reservation.status = feedback.status;
      if (decision === 'accept')
        state.ledger.push({
          id: id('award'),
          campaignId: feedback.campaignId,
          reservationId: reservation.id,
          participantId: reservation.participantId,
          amount: reservation.reward,
          unit: 'demo credits',
          settlement: 'simulated',
          transactionHash: null,
          createdAt: now(),
        });
      event(state, `feedback.${feedback.status}`, feedback.id, reason);
      return feedback;
    });
  }
  closeCampaign(campaignId) {
    return this.store.change((state) => {
      const campaign = find(state.campaigns, campaignId, 'Campaign');
      campaign.status = 'closed';
      event(
        state,
        'campaign.closed',
        campaign.id,
        'New reservations stopped. Existing sessions can still submit.',
      );
      return campaign;
    });
  }
  report(campaignId) {
    const state = this.overview();
    const campaign = find(state.campaigns, campaignId, 'Campaign');
    const release = find(state.releases, campaign.releaseId, 'Release');
    const feedback = state.feedback.filter((f) => f.campaignId === campaignId);
    return {
      campaign,
      release,
      feedback,
      summary: {
        submissions: feedback.length,
        accepted: feedback.filter((f) => f.status === 'accepted').length,
        blocked: feedback.filter((f) => f.outcome === 'blocked').length,
        evidenceType: 'self-reported tester observations reviewed by operator or calling agent',
        demandValidated: false,
      },
      nextSteps: feedback
        .filter((f) => f.outcome === 'blocked')
        .map((f) => ({ feedbackId: f.id, observation: f.observation, suggestion: f.suggestion })),
      limitations: [
        'Paid participation does not establish organic demand.',
        'Participant aliases are not proof of unique humans.',
        'This report does not establish contract security or production readiness.',
        'Demo credits have no monetary value; no blockchain payout occurred.',
      ],
    };
  }
}
