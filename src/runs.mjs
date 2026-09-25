import { createHash } from 'node:crypto';
import { z } from 'zod';
import { addProjectRecord, addReleaseRecord, createCampaignRecord } from './domain.mjs';
import { NETWORK } from './repos.mjs';
import { event, id, now, requireThat } from './store.mjs';

const text = (min, max) => z.string().trim().min(min).max(max);
export const runInput = z
  .object({
    requestKey: text(8, 100).regex(/^[a-zA-Z0-9._-]+$/),
    repoUrl: z.string().url().max(300).optional(),
    ref: text(1, 200).optional(),
    title: text(3, 100),
    goal: text(10, 1500),
    audience: text(3, 250),
    task: text(10, 1500),
    participants: z.number().int().min(1).max(100),
    budget: z.number().int().min(1).max(100000),
  })
  .strict();
export const startInput = z.object({ planDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const findRun = (state, runId) => {
  const run = (state.runs || []).find((r) => r.id === runId);
  requireThat(run, 'Run not found', 404);
  return run;
};
const LEASE_MS = 10 * 60 * 1000;

// The orchestrator keeps the existing project, release and campaign records as evidence.
// All links and state claims are committed with their records, never in a later transaction.
export class Runs {
  constructor(domain, services) {
    Object.assign(this, { domain, services, store: domain.store });
  }

  async plan(input) {
    const parsed = runInput.parse(input);
    requireThat(!parsed.ref || parsed.repoUrl, 'A ref requires a repository URL.');
    const reward = Math.floor(parsed.budget / parsed.participants);
    requireThat(
      reward >= 1 && reward <= 10000,
      'Budget must provide 1–10000 demo credits per participant.',
    );
    const requestDigest = digest(parsed);
    const existing = (state) => {
      const prior = (state.runs || []).find((r) => r.requestKey === parsed.requestKey);
      requireThat(
        !prior || prior.requestDigest === requestDigest,
        'This requestKey belongs to a different brief. Use a new key for a new plan.',
        409,
      );
      return prior;
    };
    const prior = existing(this.store.read());
    if (prior) return this.get(prior.id);
    const snapshot = await this.services.inspectProject({
      ...(parsed.repoUrl ? { repoUrl: parsed.repoUrl } : {}),
      ...(parsed.ref ? { ref: parsed.ref } : {}),
    });
    const runId = this.store.change((state) => {
      const concurrent = existing(state);
      if (concurrent) return concurrent.id;
      const project = addProjectRecord(state, snapshot);
      const plan = {
        title: parsed.title,
        goal: parsed.goal,
        audience: parsed.audience,
        task: parsed.task,
        participants: parsed.participants,
        source: {
          kind: project.sourceKind,
          repoUrl: project.repoUrl,
          commitSha: project.commitSha,
          digest: project.sourceDigest,
        },
        environment: { adapter: 'static', visibility: 'local-only', chainId: NETWORK.chainId },
        costs: {
          unit: 'demo credits',
          cap: parsed.budget,
          rewardPerAcceptedSubmission: reward,
          rewardPool: reward * parsed.participants,
          unallocated: parsed.budget - reward * parsed.participants,
          realMoneyCharged: 0,
        },
        recruitment: 'Operator invites testers; no automatic recruitment.',
        reviewPolicy: 'An honest attempt or documented blocker is eligible regardless of rating.',
        deliverable:
          'Version-linked observations, explicit review decisions and demo-credit accounting.',
      };
      const run = {
        id: id('run'),
        requestKey: parsed.requestKey,
        requestDigest,
        projectId: project.id,
        releaseId: null,
        campaignId: null,
        plan,
        planDigest: digest(plan),
        status: 'planned',
        createdAt: now(),
        updatedAt: now(),
        confirmedAt: null,
        attemptId: null,
        leaseUntil: null,
        lastError: null,
      };
      (state.runs ||= []).unshift(run);
      event(
        state,
        'run.planned',
        run.id,
        'Source and demo-credit scope pinned. No preview or campaign created.',
      );
      return run.id;
    });
    return this.get(runId);
  }

  get(runId) {
    const state = this.domain.overview();
    const run = findRun(state, runId);
    const project = state.projects.find((p) => p.id === run.projectId);
    const release = state.releases.find((r) => r.id === run.releaseId) || null;
    const report = run.campaignId ? this.domain.report(run.campaignId) : null;
    let status = run.status;
    if (report) {
      if (run.status === 'closed' || report.campaign.status === 'closed') status = 'closed';
      else if (report.summary.accepted >= run.plan.participants) status = 'completed';
      else if (report.feedback.some((f) => f.status === 'pending')) status = 'reviewing';
      else status = 'collecting';
    }
    const actions = {
      planned:
        'Review the source, mission and demo-credit cap, then start with this exact planDigest.',
      preparing:
        'Preparation is in progress. Poll this run; retry start after retryAfter if the process was interrupted.',
      blocked:
        'Read the blocker, restore the prerequisite and retry start with the same planDigest. Changed scope requires a new plan.',
      collecting:
        'Invite testers using the local experiment link. No participants have been recruited automatically.',
      reviewing:
        'Inspect the submitted evidence and record an eligibility review. Honest negative feedback qualifies.',
      completed:
        'The target number of accepted submissions is reached. Read the evidence before proposing a new run; this does not establish human uniqueness or demand.',
      closed:
        'New reservations are stopped. Existing sessions and pending reviews retain their obligations.',
    };
    return {
      id: run.id,
      status,
      plan: run.plan,
      planDigest: run.planDigest,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      confirmedAt: run.confirmedAt,
      retryAfter: status === 'preparing' ? run.leaseUntil : null,
      blocker: run.lastError,
      project,
      release,
      report,
      progress: {
        targetAcceptedSubmissions: run.plan.participants,
        submissions: report?.summary.submissions || 0,
        accepted: report?.summary.accepted || 0,
        pendingReview: report?.feedback.filter((f) => f.status === 'pending').length || 0,
        verifiedHumanParticipants: null,
      },
      links: {
        status: `/api/runs/${run.id}`,
        workspace: '/app',
        preview: release?.status === 'ready' ? release.previewUrl : null,
        experiment: run.campaignId ? `/app#experiment=${run.campaignId}` : null,
        report: run.campaignId ? `/api/campaigns/${run.campaignId}/report` : null,
      },
      nextAction: actions[status],
      timeline: state.events.filter((e) => e.subject === run.id),
      limitations: [
        'Local static preview only; no public deployment, arbitrary builds or smart-contract transactions.',
        'Demo credits have no monetary value; no service charge or participant payout occurred.',
        'Participant aliases and accepted submissions do not establish unique human testers or organic demand.',
        'No OKX marketplace order or live x402 settlement is created by this run.',
      ],
    };
  }

  list() {
    return (this.store.read().runs || []).map((r) => {
      const result = this.get(r.id);
      return {
        id: r.id,
        title: r.plan.title,
        status: result.status,
        createdAt: r.createdAt,
        progress: result.progress,
        links: result.links,
      };
    });
  }

  async start(runId, input) {
    const { planDigest } = startInput.parse(input);
    const claim = this.store.change((state) => {
      const run = findRun(state, runId);
      requireThat(
        run.planDigest === planDigest,
        'Plan digest does not match the confirmed scope.',
        409,
      );
      requireThat(run.status !== 'closed', 'This run is closed. Create a new plan.', 409);
      if (run.campaignId || (run.status === 'preparing' && Date.parse(run.leaseUntil) > Date.now()))
        return null;
      const previous = state.releases.find((r) => r.id === run.releaseId);
      if (previous?.status === 'preparing') {
        previous.status = 'failed';
        previous.checkedAt = now();
        previous.checks.push({
          name: 'Preparation interrupted',
          status: 'fail',
          detail: 'Previous run attempt expired; a new attempt uses a new release.',
        });
      }
      run.status = 'preparing';
      run.attemptId = id('attempt');
      run.leaseUntil = new Date(Date.now() + LEASE_MS).toISOString();
      run.confirmedAt ||= now();
      run.updatedAt = now();
      run.lastError = null;
      if (previous?.status !== 'ready') {
        const release = addReleaseRecord(state, run.projectId, {
          adapter: 'static',
          network: NETWORK,
          mode: 'local-preview',
        });
        run.releaseId = release.id;
      }
      event(
        state,
        'run.preparing',
        run.id,
        'Confirmed plan; preparing the pinned source with a bounded demo-credit pool.',
      );
      return {
        attemptId: run.attemptId,
        releaseId: run.releaseId,
        alreadyReady: previous?.status === 'ready',
      };
    });
    if (!claim) return this.get(runId);
    try {
      if (!claim.alreadyReady) await this.services.prepareRelease(claim.releaseId);
      await this.services.verifyRelease(claim.releaseId);
      this.store.change((state) => {
        const run = findRun(state, runId);
        requireThat(
          run.attemptId === claim.attemptId && run.status === 'preparing',
          'This preparation attempt was superseded.',
          409,
        );
        const campaign = createCampaignRecord(state, {
          releaseId: claim.releaseId,
          title: run.plan.title,
          audience: run.plan.audience,
          task: run.plan.task,
          budget: run.plan.costs.rewardPool,
          reward: run.plan.costs.rewardPerAcceptedSubmission,
        });
        run.campaignId = campaign.id;
        run.status = 'collecting';
        run.leaseUntil = null;
        run.updatedAt = now();
        event(
          state,
          'run.collecting',
          run.id,
          'Preview verified; one campaign opened. The operator must invite testers.',
        );
      });
    } catch (error) {
      this.store.change((state) => {
        const run = findRun(state, runId);
        if (run.attemptId !== claim.attemptId || run.status !== 'preparing') return;
        run.status = 'blocked';
        run.leaseUntil = null;
        run.updatedAt = now();
        run.lastError = { message: error.message.slice(0, 1000), at: now() };
        event(state, 'run.blocked', run.id, run.lastError.message);
      });
    }
    return this.get(runId);
  }

  close(runId) {
    this.store.change((state) => {
      const run = findRun(state, runId);
      requireThat(
        run.status !== 'preparing',
        'Wait for preparation to finish or recover the interrupted attempt before closing.',
        409,
      );
      if (run.status === 'closed') return;
      if (run.campaignId) {
        const campaign = state.campaigns.find((c) => c.id === run.campaignId);
        requireThat(campaign, 'Run campaign is missing.', 409);
        campaign.status = 'closed';
        event(
          state,
          'campaign.closed',
          campaign.id,
          'Run closed; existing session and review obligations remain.',
        );
      }
      run.status = 'closed';
      run.updatedAt = now();
      event(
        state,
        'run.closed',
        run.id,
        'New reservations stopped; existing obligations preserved.',
      );
    });
    return this.get(runId);
  }
}
