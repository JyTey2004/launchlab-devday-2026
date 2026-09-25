import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { hash } from '../managed/contracts.mjs';
import { requireThat } from '../store.mjs';

export const tenantId = (id) => { requireThat(/^tenant_[a-f0-9]{20}$/.test(id), 'Invalid tenant.'); return id; };
const now = () => new Date().toISOString();
const publicJob = (row) => row && ({ id: row.id, workflowId: row.workflow, operation: row.operation, status: row.status,
  createdAt: row.created, updatedAt: row.updated, recovered: Boolean(row.recovered),
  result: row.result ? JSON.parse(row.result) : null, error: row.error ? JSON.parse(row.error) : null,
  nextAction: row.status === 'queued' || row.status === 'running'
    ? { type: 'poll_job', path: `/api/agent/jobs/${row.id}`, tool: 'launchlab_get_job', pollAfterSeconds: 3 }
    : { type: 'read_workflow', path: `/api/agent/workflows/${row.workflow}`, tool: 'launchlab_get_workflow' } });

// One persistent host, multiple authenticated callers. FULL + WAL keeps accepted
// jobs durable across process restarts. A single flock-protected worker executes.
export class HostedStore {
  constructor(path, limits = {}) {
    this.limits = { queuedPerTenant: 5, workflowsPerTenant: 20, deployments: 3, dailyModelCalls: 10, tenantDailyModelCalls: 6, ...limits };
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path); chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS tenants(id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS keys(id TEXT PRIMARY KEY, tenant TEXT NOT NULL, digest TEXT UNIQUE NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS workflows(id TEXT PRIMARY KEY, tenant TEXT NOT NULL, created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, tenant TEXT NOT NULL, workflow TEXT NOT NULL, operation TEXT NOT NULL,
        request_key TEXT NOT NULL, digest TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL, created TEXT NOT NULL,
        updated TEXT NOT NULL, recovered INTEGER NOT NULL DEFAULT 0, result TEXT, error TEXT, UNIQUE(tenant,operation,workflow,request_key));
      CREATE TABLE IF NOT EXISTS deployments(workflow TEXT PRIMARY KEY, tenant TEXT NOT NULL, created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS model_calls(id INTEGER PRIMARY KEY, tenant TEXT NOT NULL, day TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS worker_health(id INTEGER PRIMARY KEY CHECK(id=1), at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(status,created);
    `);
  }
  close() { this.db.close(); }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  createTenant(name) {
    requireThat(typeof name === 'string' && name.length > 0 && name.length <= 80, 'Supply a short tenant name.');
    const id = `tenant_${randomBytes(10).toString('hex')}`;
    this.db.prepare('INSERT INTO tenants VALUES (?,?)').run(id, name);
    return id;
  }
  issueKey(tenant) {
    requireThat(this.db.prepare('SELECT id FROM tenants WHERE id=?').get(tenantId(tenant)), 'Tenant not found.', 404);
    const id = `key_${randomBytes(10).toString('hex')}`, token = `ll_${randomBytes(32).toString('base64url')}`;
    this.db.prepare('INSERT INTO keys(id,tenant,digest) VALUES (?,?,?)').run(id, tenant, hash(token));
    return { id, tenant, token };
  }
  revokeKey(id) { this.db.prepare('UPDATE keys SET revoked=1 WHERE id=?').run(id); }
  authenticate(header) {
    const match = /^Bearer (ll_[A-Za-z0-9_-]{43})$/.exec(header || '');
    const key = match && this.db.prepare('SELECT tenant FROM keys WHERE digest=? AND revoked=0').get(hash(match[1]));
    requireThat(key, 'A valid LaunchLab service key is required.', 401);
    return key.tenant;
  }
  owns(tenant, workflow) {
    requireThat(this.db.prepare('SELECT id FROM workflows WHERE id=? AND tenant=?').get(workflow, tenant), 'Workflow not found.', 404);
  }
  enqueue({ tenant, workflow, operation, requestKey, payload }) {
    tenantId(tenant);
    requireThat(typeof requestKey === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(requestKey), 'Use an 8–100 character Idempotency-Key for this operation.');
    const digest = hash(payload);
    return this.transaction(() => {
      const prior = this.db.prepare('SELECT * FROM jobs WHERE tenant=? AND operation=? AND workflow=? AND request_key=?').get(tenant, operation, workflow, requestKey);
      if (prior) { requireThat(prior.digest === digest, 'Idempotency key already used with different input.', 409); return publicJob(prior); }
      if (operation !== 'create') this.owns(tenant, workflow);
      const active = this.db.prepare("SELECT count(*) AS n FROM jobs WHERE tenant=? AND status IN ('queued','running')").get(tenant).n;
      requireThat(active < this.limits.queuedPerTenant, 'Your active job limit is reached.', 429);
      requireThat(!this.db.prepare("SELECT id FROM jobs WHERE workflow=? AND status IN ('queued','running')").get(workflow), 'This workflow already has an active job.', 409);
      if (operation === 'create') {
        requireThat(this.db.prepare('SELECT count(*) AS n FROM workflows WHERE tenant=?').get(tenant).n < this.limits.workflowsPerTenant, 'Workflow limit reached.', 429);
        this.db.prepare('INSERT INTO workflows VALUES (?,?,?)').run(workflow, tenant, now());
      }
      const id = `job_${randomBytes(12).toString('hex')}`, at = now();
      this.db.prepare('INSERT INTO jobs(id,tenant,workflow,operation,request_key,digest,payload,status,created,updated) VALUES (?,?,?,?,?,?,?,\'queued\',?,?)')
        .run(id, tenant, workflow, operation, requestKey, digest, JSON.stringify(payload), at, at);
      return this.job(tenant, id);
    });
  }
  job(tenant, id) {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id=? AND tenant=?').get(id, tenant);
    requireThat(row, 'Job not found.', 404); return publicJob(row);
  }
  latest(tenant, workflow) {
    this.owns(tenant, workflow);
    return publicJob(this.db.prepare('SELECT * FROM jobs WHERE tenant=? AND workflow=? ORDER BY rowid DESC LIMIT 1').get(tenant, workflow));
  }
  recover() {
    // No blind replay: the executor reconciles saved workflow state on recovery.
    this.db.prepare("UPDATE jobs SET status='queued', recovered=1, updated=? WHERE status='running'").run(now());
  }
  claim() {
    return this.transaction(() => {
      const job = this.db.prepare("SELECT * FROM jobs WHERE status='queued' ORDER BY rowid LIMIT 1").get();
      if (!job) return null;
      this.db.prepare("UPDATE jobs SET status='running', updated=? WHERE id=?").run(now(), job.id);
      return { ...job, payload: JSON.parse(job.payload) };
    });
  }
  finish(job, result, status = 'completed') {
    this.db.prepare('UPDATE jobs SET status=?,result=?,updated=? WHERE id=? AND tenant=?').run(status, JSON.stringify(result), now(), job.id, job.tenant);
  }
  fail(job, error) {
    // Do not persist stack traces, arguments, upstream bodies or secret values.
    this.db.prepare("UPDATE jobs SET status='failed',error=?,updated=? WHERE id=? AND tenant=?")
      .run(JSON.stringify({ message: error.status && error.status < 500 ? error.message : 'The operation stopped. Read the workflow for its next action.', status: error.status || 500 }), now(), job.id, job.tenant);
  }
  reserveDeployment(tenant, workflow) {
    return this.transaction(() => {
      this.owns(tenant, workflow);
      if (this.db.prepare('SELECT workflow FROM deployments WHERE workflow=?').get(workflow)) return;
      requireThat(this.db.prepare('SELECT count(*) AS n FROM deployments').get().n < this.limits.deployments, 'The hosted demo deployment limit is reached. Ask the operator to retire an environment.', 429);
      this.db.prepare('INSERT INTO deployments VALUES (?,?,?)').run(workflow, tenant, now());
    });
  }
  reserveModelCall(tenant) {
    const day = now().slice(0, 10);
    return this.transaction(() => {
      requireThat(this.db.prepare('SELECT count(*) AS n FROM model_calls WHERE day=?').get(day).n < this.limits.dailyModelCalls
        && this.db.prepare('SELECT count(*) AS n FROM model_calls WHERE day=? AND tenant=?').get(day, tenant).n < this.limits.tenantDailyModelCalls,
      'Daily model-call allowance reached. No model request was sent.', 429);
      this.db.prepare('INSERT INTO model_calls(tenant,day) VALUES (?,?)').run(tenant, day);
    });
  }
  heartbeat() { this.db.prepare('INSERT INTO worker_health VALUES (1,?) ON CONFLICT(id) DO UPDATE SET at=excluded.at').run(Date.now()); }
  workerReady() { return Date.now() - (this.db.prepare('SELECT at FROM worker_health WHERE id=1').get()?.at || 0) < 30000; }
}
