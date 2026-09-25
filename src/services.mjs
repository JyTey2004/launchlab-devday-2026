import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { exampleSnapshot, repositorySnapshot, NETWORK } from './repos.mjs';
import { requireThat } from './store.mjs';
import { z } from 'zod';

export class Services {
  constructor(domain, artifactsDir, previewOrigin) {
    Object.assign(this, { domain, artifactsDir, previewOrigin });
  }
  async inspectProject(input = {}) {
    const { repoUrl, ref } = z
      .object({
        repoUrl: z.string().url().max(300).optional(),
        ref: z.string().min(1).max(200).optional(),
      })
      .strict()
      .parse(input);
    return repoUrl ? repositorySnapshot(repoUrl, ref) : exampleSnapshot();
  }
  async importProject(input = {}) {
    return this.domain.addProject(await this.inspectProject(input));
  }
  async deploy(projectId) {
    const project = this.domain.store.read().projects.find((p) => p.id === projectId);
    requireThat(project, 'Project not found', 404);
    const release = this.domain.addRelease(projectId, {
      adapter: 'static',
      network: NETWORK,
      mode: 'local-preview',
    });
    return this.prepareRelease(release.id);
  }
  async prepareRelease(releaseId) {
    const state = this.domain.store.read();
    const release = state.releases.find((r) => r.id === releaseId);
    requireThat(release?.status === 'preparing', 'A preparing release is required.', 409);
    const project = state.projects.find((p) => p.id === release.projectId);
    requireThat(project, 'Project not found', 404);
    const checks = [];
    const previewUrl = `${this.previewOrigin}/releases/${release.id}/index.html`;
    try {
      const snapshot =
        project.sourceKind === 'bundled'
          ? await exampleSnapshot()
          : await repositorySnapshot(project.repoUrl, project.commitSha);
      requireThat(
        snapshot.digest === project.sourceDigest,
        'Source changed since import. Import a new version before deployment.',
        409,
      );
      checks.push(
        {
          name: 'Source pinned',
          status: 'pass',
          detail: project.commitSha
            ? `Git commit ${project.commitSha}`
            : `SHA-256 ${snapshot.digest}`,
        },
        {
          name: 'Static package',
          status: 'pass',
          detail: `${Object.keys(snapshot.files).length} files; no build scripts executed`,
        },
        {
          name: 'Network declared',
          status: 'pass',
          detail: 'X Layer Testnet · chain 1952. No contract deployment claimed.',
        },
      );
      for (const [path, text] of Object.entries(snapshot.files)) {
        const destination = join(this.artifactsDir, release.id, path);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, text, { flag: 'wx' });
      }
      // Probe the actual preview server, not merely the presence of files.
      const response = await fetch(previewUrl, {
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
      });
      requireThat(
        response.ok && (await response.text()) === snapshot.files['index.html'],
        'Preview HTTP probe failed',
        502,
      );
      checks.push({
        name: 'Live preview',
        status: 'pass',
        detail: 'HTTP 200 and entry bytes match the pinned snapshot',
      });
      return this.domain.finishRelease(release.id, { status: 'ready', previewUrl, checks });
    } catch (error) {
      checks.push({ name: 'Live preview', status: 'fail', detail: error.message });
      if (
        this.domain.store.read().releases.find((r) => r.id === release.id)?.status === 'preparing'
      )
        this.domain.finishRelease(release.id, { status: 'failed', previewUrl: null, checks });
      throw error;
    }
  }
  async verifyRelease(releaseId) {
    const release = this.domain.store.read().releases.find((r) => r.id === releaseId);
    requireThat(release?.status === 'ready', 'A verified preview is required.', 409);
    const response = await fetch(release.previewUrl, {
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    const expected = await readFile(join(this.artifactsDir, release.id, 'index.html'), 'utf8');
    requireThat(
      response.ok && (await response.text()) === expected,
      'Preview is unavailable. Restore it before opening a campaign.',
      409,
    );
  }
  async createCampaign(input) {
    await this.verifyRelease(input.releaseId);
    return this.domain.createCampaign(input);
  }
}
