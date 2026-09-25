import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeApplication } from '../src/deployment-recipe.mjs';

function analyze(pkg, paths = [], extra = {}) {
  return analyzeApplication({
    pkg,
    hasPackage: true,
    files: new Set(paths),
    rootDirectory: '.',
    environmentKeys: [],
    ...extra,
  });
}
const vite = {
  dependencies: { vite: '7', react: '19' },
  scripts: { build: 'tsc -b && vite build' },
};

test('ordinary Vite frontend gets an advisory build recipe with an unverified default output', () => {
  const result = analyze(vite, ['package.json', 'package-lock.json', 'index.html']);
  assert.equal(result.detected.framework, 'vite');
  assert.deepEqual(result.detected.libraries, ['react']);
  assert.equal(result.recipe.delivery, 'static_assets');
  assert.equal(result.recipe.install.command, 'npm ci');
  assert.equal(result.recipe.build.command, 'npm run build');
  assert.deepEqual(result.recipe.output, {
    directory: 'dist',
    basis: 'framework_default_unverified',
    verified: false,
  });
  assert.equal(result.recipe.canDeploy, false);
  assert.equal(result.recipe.adapter.implemented, false);
  assert.deepEqual(result.questions, []);
});

test('frameworks that use Vite are identified without pretending their deployment adapter exists', () => {
  for (const [dependency, expected] of [
    ['@sveltejs/kit', 'sveltekit'],
    ['nuxt', 'nuxt'],
    ['astro', 'astro'],
    ['vinext', 'vinext'],
    ['@react-router/dev', 'react-router'],
    ['@remix-run/dev', 'remix'],
    ['@tanstack/react-start', 'tanstack-start'],
  ]) {
    const result = analyze({ ...vite, dependencies: { vite: '7', [dependency]: '1' } }, [
      'package-lock.json',
      'index.html',
    ]);
    assert.equal(result.detected.framework, expected);
    assert.equal(result.recipe.status, 'adapter_review_required');
    assert.equal(result.recipe.provider, null);
    assert.equal(result.recipe.output.directory, null);
    assert.equal(result.recipe.build.command, null);
  }
});

test('SSR, worker and backend signals do not get a static frontend delivery recipe', () => {
  for (const pkg of [
    { ...vite, scripts: { build: 'vite build --ssr src/server.ts' } },
    { ...vite, dependencies: { ...vite.dependencies, '@cloudflare/vite-plugin': '1' } },
    { ...vite, dependencies: { ...vite.dependencies, express: '5' } },
  ]) {
    const result = analyze(pkg, ['package-lock.json', 'index.html']);
    assert.equal(result.recipe.delivery, 'runtime_review_required');
    assert.equal(result.recipe.output.directory, null);
    assert.ok(result.questions.some((q) => q.id === 'externalServices'));
  }
  const library = analyze(vite, ['package-lock.json']);
  assert.ok(library.questions.some((q) => q.id === 'entryPoint'));
  assert.equal(library.recipe.delivery, 'runtime_review_required');
});

test('custom config triggers a review instead of claiming the default output has been verified', () => {
  const result = analyze(vite, [
    'package-lock.json',
    'index.html',
    'vite.config.ts',
    'vercel.json',
  ]);
  assert.equal(result.recipe.status, 'needs_input');
  assert.equal(result.recipe.output.verified, false);
  assert.ok(result.questions.some((q) => q.id === 'frameworkConfiguration'));
  assert.ok(result.evidence.some((item) => item.path === 'vite.config.ts'));
});

test('conflicting declarations prevent proposing an install command', () => {
  const result = analyze({ ...vite, packageManager: 'pnpm@10.0.0' }, [
    'package-lock.json',
    'index.html',
  ]);
  assert.equal(result.detected.packageManager, null);
  assert.equal(result.recipe.install.command, null);
  assert.ok(result.questions.some((q) => q.id === 'packageManager'));
  const noLock = analyze({ ...vite, packageManager: 'pnpm@10.0.0' }, ['index.html']);
  assert.equal(noLock.detected.packageManager, 'pnpm');
  assert.equal(noLock.recipe.install.command, null);
  assert.ok(noLock.questions.some((q) => q.id === 'packageManager'));
});

test('Yarn install mode requires the declared major version', () => {
  for (const [version, expected] of [
    ['1.22.22', 'yarn install --frozen-lockfile'],
    ['4.5.0', 'yarn install --immutable'],
  ]) {
    const result = analyze({ ...vite, packageManager: `yarn@${version}` }, [
      'yarn.lock',
      'index.html',
    ]);
    assert.equal(result.recipe.install.command, expected);
  }
  const unpinned = analyze(vite, ['yarn.lock', 'index.html']);
  assert.equal(unpinned.recipe.install.command, null);
  assert.ok(unpinned.questions.some((q) => q.id === 'packageManagerVersion'));
});

test('nested workspace lockfile is evidence but does not imply a valid workspace build command', () => {
  const result = analyze(vite, ['apps/pnpm-lock.yaml', 'apps/frontend/web/index.html'], {
    rootDirectory: 'apps/frontend/web',
  });
  assert.equal(result.detected.packageManager, 'pnpm');
  assert.equal(result.recipe.install.workingDirectory, 'apps');
  assert.equal(result.recipe.install.command, null);
  assert.equal(result.recipe.build.command, null);
  assert.ok(result.questions.some((q) => q.id === 'workspaceBuild'));
});

test('secret-looking scripts and arbitrary metadata are never copied into an agent recipe', () => {
  const result = analyze(
    {
      ...vite,
      scripts: { build: 'echo script-secret && vite build' },
      engines: { node: 'echo engine-secret' },
      packageManager: 'npm@$(echo manager-secret)',
      dependencies: { ...vite.dependencies, 'injected-secret': 'value-secret' },
    },
    ['package-lock.json', 'index.html'],
  );
  const output = JSON.stringify(result);
  for (const secret of [
    'script-secret',
    'engine-secret',
    'manager-secret',
    'injected-secret',
    'value-secret',
  ])
    assert.ok(!output.includes(secret));
  assert.equal(result.recipe.build.command, 'npm run build');
  assert.equal(result.detected.nodeVersionRange, null);
});

test('a plain HTML directory needs no package install, while an unknown runtime stays unresolved', () => {
  const html = analyze({}, ['index.html'], { hasPackage: false });
  assert.equal(html.recipe.output.directory, '.');
  assert.equal(html.recipe.install.command, null);
  assert.equal(html.recipe.build.command, null);
  const python = analyze({}, ['requirements.txt', 'app.py'], { hasPackage: false });
  assert.equal(python.detected.framework, 'unknown');
  assert.equal(python.recipe.provider, null);
  assert.equal(python.recipe.status, 'adapter_review_required');
});
