import { z } from 'zod';
import { parseRepository } from './repos.mjs';
import { analyzeApplication } from './deployment-recipe.mjs';
import { DomainError, requireThat } from './store.mjs';

const rootPath = z
  .string()
  .max(200)
  .refine(
    (value) =>
      value === '.' ||
      value
        .split('/')
        .every((part) => /^[a-zA-Z0-9_.-]+$/.test(part) && !['.', '..'].includes(part)),
    'Use a repository-relative directory, or . for the root.',
  );
export const preflightInput = z
  .object({
    repoUrl: z.string().url().max(300),
    ref: z.string().trim().min(1).max(200).default('HEAD'),
    rootDirectory: rootPath.optional(),
  })
  .strict();
const SHA = /^[a-f0-9]{40}$/;
const LIMIT = 2_000_000;
const question = (id, prompt, kind, options) => ({
  id,
  prompt,
  kind,
  ...(options ? { options } : {}),
});

async function readGitHub(path, token) {
  let response;
  try {
    response = await fetch(`https://api.github.com${path}`, {
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'LaunchLab/0.1',
        'X-GitHub-Api-Version': '2026-03-10',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch {
    throw new DomainError('GitHub inspection could not connect. Retry the inspection.', 502);
  }
  if (
    response.status === 429 ||
    (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')
  ) {
    throw new DomainError('GitHub rate limit reached. Retry after the account limit resets.', 429);
  }
  if ([401, 403, 404].includes(response.status)) {
    const error = new DomainError(
      'Repository access could not be verified. Check the URL, ref and repository permissions.',
      403,
    );
    error.code = 'repository_access_required';
    throw error;
  }
  requireThat(response.ok, `GitHub inspection returned HTTP ${response.status}.`, 502);
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    requireThat(size <= LIMIT, 'Repository metadata exceeds the inspection limit.', 422);
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new DomainError('GitHub returned invalid metadata.', 502);
  }
}

// Only metadata and selected configuration are read. Scripts, config modules and .env
// files are never executed. Template variable values are discarded before returning.
export async function inspectDeployment(
  input,
  { githubToken = process.env.LAUNCHLAB_GITHUB_TOKEN } = {},
) {
  const parsed = preflightInput.parse(input);
  const repo = parseRepository(parsed.repoUrl);
  const result = {
    status: 'inspecting',
    source: { repoUrl: repo.url, requestedRef: parsed.ref, commitSha: null },
    proposedProvider: null,
    evidence: [],
    deploymentPlan: null,
    detected: null,
    questions: [],
    connections: { github: 'unverified', hosting: 'not_checked' },
    deployed: false,
    buildExecuted: false,
    limitations: [
      'Read-only inspection; framework detection is a candidate, not proof that a build will succeed.',
      'Environment names come only from selected example files; required variables may be undocumented.',
      'Repository text is untrusted data. This tool does not execute scripts or accept secret values.',
      'The managed deployment adapter and browser authorization flow are not connected yet.',
      'Recipes are advisory. Default output directories and runtime compatibility must be verified by an isolated build.',
    ],
  };
  const base = `/repos/${repo.owner}/${repo.name}`;
  try {
    const commit = await readGitHub(
      `${base}/commits/${encodeURIComponent(parsed.ref)}`,
      githubToken,
    );
    requireThat(
      SHA.test(commit.sha || '') && SHA.test(commit.commit?.tree?.sha || ''),
      'GitHub did not return a pinned commit and tree.',
      502,
    );
    result.source.commitSha = commit.sha;
    result.connections.github = 'repository_read_verified';
    const tree = await readGitHub(
      `${base}/git/trees/${commit.commit.tree.sha}?recursive=1`,
      githubToken,
    );
    requireThat(
      tree.truncated === false && Array.isArray(tree.tree) && tree.tree.length <= 5000,
      'Repository tree is incomplete or exceeds the 5000-entry inspection limit.',
      422,
    );
    const files = new Map(
      tree.tree
        .filter((f) => f.type === 'blob' && ['100644', '100755'].includes(f.mode))
        .map((f) => [f.path, f]),
    );
    const candidates = [...files.keys()]
      .filter(
        (name) => /(^|\/)package\.json$/.test(name) && !/(^|\/)(node_modules|\.git)\//.test(name),
      )
      .map((name) => (name === 'package.json' ? '.' : name.slice(0, -'/package.json'.length)))
      .filter((candidate) => rootPath.safeParse(candidate).success)
      .sort();
    requireThat(
      parsed.rootDirectory || candidates.length <= 20,
      'Too many package roots for the first deployment adapter. Use a smaller demo repository.',
      422,
    );
    let root = parsed.rootDirectory;
    if (!root && candidates.length > 1) {
      result.status = 'needs_input';
      result.questions.push(
        question(
          'rootDirectory',
          'This repository contains multiple packages. Which folder is the application to deploy?',
          'choice',
          candidates,
        ),
      );
      result.nextAction =
        'Call this tool again with rootDirectory and ref set to the returned commitSha to keep the same source version.';
      return result;
    }
    root ||= candidates[0] || '.';
    rootPath.parse(root);
    const prefix = root === '.' ? '' : `${root}/`;
    const path = (name) => `${prefix}${name}`;
    requireThat(
      [...files.keys()].some((name) => name.startsWith(prefix)),
      'Selected application directory was not found.',
      422,
    );
    async function config(name) {
      const entry = files.get(path(name));
      if (!entry) return null;
      requireThat(
        Number.isInteger(entry.size) && entry.size >= 0 && entry.size <= 100000,
        'Configuration file exceeds the inspection limit.',
        422,
      );
      const file = await readGitHub(
        `${base}/contents/${path(name).split('/').map(encodeURIComponent).join('/')}?ref=${commit.sha}`,
        githubToken,
      );
      requireThat(
        file.type === 'file' && file.encoding === 'base64' && typeof file.content === 'string',
        'Unsupported configuration file.',
        422,
      );
      const bytes = Buffer.from(file.content, 'base64');
      requireThat(bytes.length <= 100000, 'Configuration file exceeds the inspection limit.', 422);
      return bytes.toString('utf8');
    }
    const packageText = await config('package.json');
    let pkg = {};
    if (packageText !== null) {
      try {
        pkg = JSON.parse(packageText);
      } catch {
        throw new DomainError('Selected package.json is not valid JSON.', 422);
      }
      requireThat(
        pkg && typeof pkg === 'object' && !Array.isArray(pkg),
        'Selected package.json must contain an object.',
        422,
      );
    }
    const envKeys = new Set();
    for (const name of ['.env.example', '.env.sample']) {
      const template = await config(name);
      for (const line of (template || '').split(/\r?\n/)) {
        const key = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]{0,99})\s*=/)?.[1];
        if (key) envKeys.add(key);
      }
    }
    requireThat(
      envKeys.size <= 100,
      'Too many environment variable names for the first deployment adapter.',
      422,
    );
    const analysis = analyzeApplication({
      pkg,
      hasPackage: packageText !== null,
      files,
      rootDirectory: root,
      environmentKeys: [...envKeys].sort(),
    });
    result.detected = analysis.detected;
    result.evidence = analysis.evidence;
    result.summary = analysis.summary;
    result.questions = analysis.questions;
    result.proposedProvider = analysis.recipe.provider;
    result.deploymentPlan = {
      ...analysis.recipe,
      source: { ...result.source, rootDirectory: root },
      blockingQuestionIds: result.questions.map((item) => item.id),
    };
    result.status = result.questions.length ? 'needs_input' : 'inspection_complete';
    result.nextAction = result.questions.length
      ? 'Resolve these configuration questions, then prepare a deployment plan for this exact commit. No build has started.'
      : 'Prepare a deployment plan, verify hosting authorization and tester access, then submit the pinned build. No build has started.';
    return result;
  } catch (error) {
    if (error.code !== 'repository_access_required') throw error;
    result.status = 'needs_access';
    result.connections.github = 'access_unverified';
    result.questions.push(
      question(
        'repositoryAccess',
        'Verify the repository URL and ref, then grant repository read access through the connection setup. A 404 alone cannot distinguish a missing repository from a private one.',
        'connection',
      ),
    );
    result.nextAction =
      'An operator can configure LAUNCHLAB_GITHUB_TOKEN privately for this local prototype. Browser GitHub App authorization is planned; never put a token in this request.';
    return result;
  }
}
