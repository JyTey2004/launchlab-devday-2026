// Repository metadata is evidence, never executable configuration. This module
// emits an advisory recipe, not a command/job that a worker may execute directly.
const frameworks = [
  ['vinext', 'vinext'],
  ['@sveltejs/kit', 'sveltekit'],
  ['nuxt', 'nuxt'],
  ['astro', 'astro'],
  ['@react-router/dev', 'react-router'],
  ['@remix-run/dev', 'remix'],
  ['@tanstack/react-start', 'tanstack-start'],
  ['next', 'nextjs'],
];
const locks = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
];
const question = (id, prompt, kind = 'configuration', options) => ({
  id,
  prompt,
  kind,
  ...(options ? { options } : {}),
});
const object = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const labels = { nextjs: 'Next.js', vite: 'Vite', static: 'Static HTML' };

export function analyzeApplication({ pkg, hasPackage, files, rootDirectory, environmentKeys }) {
  const prefix = rootDirectory === '.' ? '' : `${rootDirectory}/`;
  const path = (name) => `${prefix}${name}`;
  const has = (name) => files.has(path(name));
  const deps = { ...object(pkg.dependencies), ...object(pkg.devDependencies) };
  const scripts = object(pkg.scripts);
  const build = typeof scripts.build === 'string' ? scripts.build : '';
  const hasBuildScript = Boolean(build.trim());
  const evidence = [];
  const questions = [];
  const detectedFrameworks = frameworks.filter(([name]) => Object.hasOwn(deps, name));
  // Vite is also an implementation detail of full-stack frameworks. Do not
  // classify those applications as ordinary static Vite frontends.
  if (
    Object.hasOwn(deps, 'vite') &&
    (!detectedFrameworks.length || detectedFrameworks.some(([, id]) => id === 'nextjs'))
  )
    detectedFrameworks.push(['vite', 'vite']);
  const framework =
    detectedFrameworks.length > 1
      ? 'ambiguous'
      : detectedFrameworks[0]?.[1] || (!hasPackage && has('index.html') ? 'static' : 'unknown');
  for (const [dependency] of detectedFrameworks)
    evidence.push({ path: path('package.json'), signal: `Declares ${dependency}.` });
  if (framework === 'static')
    evidence.push({
      path: path('index.html'),
      signal: 'HTML entry point without a package manifest.',
    });
  if (hasBuildScript)
    evidence.push({
      path: path('package.json'),
      signal: 'Defines a build script; its body is not executed or returned.',
    });

  const ancestors = [rootDirectory];
  let parent = rootDirectory;
  while (parent !== '.') {
    parent = parent.includes('/') ? parent.slice(0, parent.lastIndexOf('/')) : '.';
    ancestors.push(parent);
  }
  const lockfiles = ancestors.flatMap((directory) =>
    locks
      .map(([name, manager]) => ({
        path: directory === '.' ? name : `${directory}/${name}`,
        manager,
        directory,
      }))
      .filter((lock) => files.has(lock.path)),
  );
  const managers = [...new Set(lockfiles.map((lock) => lock.manager))];
  const declaration =
    typeof pkg.packageManager === 'string'
      ? pkg.packageManager.match(
          /^(npm|pnpm|yarn|bun)@(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?)(?:\+sha(?:224|256|384|512)\.[a-fA-F0-9]+)?$/,
        )
      : null;
  const declaredManager = declaration?.[1] || null;
  const declaredVersion = declaration?.[2] || null;
  const conflictingManager =
    managers.length > 1 ||
    (declaredManager && managers.length === 1 && declaredManager !== managers[0]);
  const packageManager = conflictingManager ? null : managers[0] || declaredManager;
  for (const lock of lockfiles)
    evidence.push({ path: lock.path, signal: `${lock.manager} lockfile.` });
  if (declaredManager)
    evidence.push({
      path: path('package.json'),
      signal: `Pins ${declaredManager} ${declaredVersion}.`,
    });
  const selectedLock = lockfiles.find((lock) => lock.manager === packageManager);
  const workspaceReview = Boolean(selectedLock && selectedLock.directory !== rootDirectory);

  const configuration = [
    'vercel.json',
    'Dockerfile',
    'docker-compose.yml',
    'compose.yaml',
    'launchlab.json',
    'next.config.js',
    'next.config.mjs',
    'next.config.ts',
    'vite.config.js',
    'vite.config.mjs',
    'vite.config.ts',
    'vite.config.mts',
    'vite.config.cjs',
    'vite.config.cts',
    'wrangler.json',
    'wrangler.jsonc',
    'wrangler.toml',
  ].filter(has);
  const runtimeSignals = [
    'prisma',
    '@prisma/client',
    'drizzle-orm',
    'postgres',
    'pg',
    'redis',
    '@supabase/supabase-js',
    'express',
    'fastify',
    'hono',
    '@cloudflare/vite-plugin',
    'nitro',
    'nitropack',
    'vike',
  ].filter((name) => Object.hasOwn(deps, name));
  const runtimeReviewRequired =
    runtimeSignals.length > 0 ||
    environmentKeys.some((key) => /^(DATABASE|POSTGRES|REDIS|SUPABASE)(_|$)/.test(key)) ||
    configuration.some((name) =>
      /^(Dockerfile|compose\.|docker-compose\.|wrangler\.)/.test(name),
    ) ||
    /(?:^|\s)--ssr(?:\s|=|$)/.test(build);
  for (const dependency of runtimeSignals)
    evidence.push({
      path: path('package.json'),
      signal: `Declares ${dependency}; review runtime or external-service requirements.`,
    });
  for (const name of configuration)
    evidence.push({
      path: path(name),
      signal: 'Configuration exists; contents have not been evaluated.',
    });
  for (const name of ['.env.example', '.env.sample'])
    if (has(name))
      evidence.push({
        path: path(name),
        signal: 'Only environment variable names were extracted.',
      });

  const supported = ['nextjs', 'vite', 'static'].includes(framework);
  if (!supported)
    questions.push(
      question(
        'framework',
        framework === 'ambiguous' || framework === 'unknown'
          ? 'A framework could not be selected confidently. Which application/runtime should we deploy?'
          : `${framework} was detected. Its deployment adapter needs review; which hosting runtime should this application use?`,
      ),
    );
  if (hasPackage && (!packageManager || !selectedLock))
    questions.push(
      question(
        'packageManager',
        conflictingManager
          ? 'Package-manager declarations or lockfiles conflict. Which manager and lockfile are authoritative?'
          : 'A reproducible dependency install could not be determined. Which package manager and committed lockfile should the build use?',
        'configuration',
        ['npm', 'pnpm', 'yarn', 'bun'],
      ),
    );
  if (packageManager === 'yarn' && !declaredVersion)
    questions.push(
      question(
        'packageManagerVersion',
        'Which Yarn version does this repository require? Pin packageManager so the correct immutable-install option can be selected.',
      ),
    );
  if (workspaceReview)
    questions.push(
      question(
        'workspaceBuild',
        'The lockfile is outside the selected app folder. Confirm the workspace install location and app build command before deployment.',
      ),
    );
  if (['nextjs', 'vite'].includes(framework) && !hasBuildScript)
    questions.push(
      question(
        'buildCommand',
        'The framework was detected but package.json has no build script. What is the intended build command?',
      ),
    );
  if (configuration.some((name) => name === 'vercel.json' || /^(next|vite)\.config\./.test(name)))
    questions.push(
      question(
        'frameworkConfiguration',
        'Custom framework or hosting configuration exists. Confirm its output directory, routing and runtime requirements before using a default deployment recipe.',
      ),
    );
  if (framework === 'vite' && !has('index.html'))
    questions.push(
      question(
        'entryPoint',
        'Vite is installed but no index.html entry exists in this folder. Is this a library, server-rendered app, or an app with a custom root?',
      ),
    );
  if (environmentKeys.length)
    questions.push(
      question(
        'environment',
        'Which listed environment variables are required for the preview? Supply values through secure settings, not agent chat.',
        'secure_configuration',
        environmentKeys,
      ),
    );
  if (runtimeReviewRequired)
    questions.push(
      question(
        'externalServices',
        'This application has runtime or external-service signals. Confirm the server runtime and any test databases or services it requires.',
      ),
    );

  const installCommands = {
    npm: 'npm ci',
    pnpm: 'pnpm install --frozen-lockfile',
    bun: 'bun install --frozen-lockfile',
    yarn:
      declaredVersion && Number(declaredVersion.split('.')[0]) === 1
        ? 'yarn install --frozen-lockfile'
        : 'yarn install --immutable',
  };
  const installCommand =
    selectedLock &&
    !workspaceReview &&
    packageManager &&
    !(packageManager === 'yarn' && !declaredVersion)
      ? installCommands[packageManager]
      : null;
  const nodeRange =
    typeof pkg.engines?.node === 'string' && /^[\d.vxX*<>=~^| -]{1,80}$/.test(pkg.engines.node)
      ? pkg.engines.node
      : null;
  const staticVite = framework === 'vite' && has('index.html') && !runtimeReviewRequired;
  const outputDirectory = framework === 'static' ? '.' : staticVite ? 'dist' : null;
  const summary = !supported
    ? `Detected ${framework}; a deployment recipe needs review.`
    : `${labels[framework]} detected. ${questions.length ? `${questions.length} configuration question(s) need answers.` : 'A candidate deployment recipe is available.'}`;
  return {
    detected: {
      rootDirectory,
      framework,
      packageManager,
      packageManagerVersion: packageManager === declaredManager ? declaredVersion : null,
      nodeVersionRange: nodeRange,
      libraries: ['react', 'vue', 'svelte', 'preact'].filter((name) => Object.hasOwn(deps, name)),
      hasBuildScript,
      environmentKeys,
      configuration,
      runtimeReviewRequired,
      lockfiles: lockfiles.map(({ path, manager }) => ({ path, manager })),
    },
    evidence,
    questions,
    summary,
    recipe: {
      version: 1,
      kind: 'advisory',
      canDeploy: false,
      status: !supported
        ? 'adapter_review_required'
        : questions.length
          ? 'needs_input'
          : 'configuration_candidate',
      provider: supported ? 'vercel' : null,
      frameworkPreset: ['nextjs', 'vite'].includes(framework) ? framework : null,
      delivery:
        framework === 'static' || staticVite
          ? 'static_assets'
          : framework === 'nextjs'
            ? 'framework_managed'
            : 'runtime_review_required',
      install: {
        command: installCommand,
        workingDirectory: selectedLock?.directory || rootDirectory,
      },
      build: {
        command:
          supported &&
          framework !== 'static' &&
          packageManager &&
          hasBuildScript &&
          !workspaceReview
            ? `${packageManager} run build`
            : null,
        workingDirectory: rootDirectory,
      },
      output: {
        directory: outputDirectory,
        basis: outputDirectory
          ? 'framework_default_unverified'
          : 'provider_or_runtime_configuration',
        verified: false,
      },
      adapter: { implemented: false, authorization: 'not_checked' },
      requirements: [
        'Resolve configuration questions and verify the recipe in an isolated provider build.',
        'Connect the LaunchLab hosting account and verify permission for this repository and deployment scope.',
        'Set preview visibility, lifetime and spending limits; provide required secrets through secure settings.',
        'For supported static frontends, request a separate managed AWS deployment plan; other runtimes require another adapter. Verify the returned URL and intended user path.',
      ],
      documentation:
        framework === 'nextjs'
          ? 'https://vercel.com/docs/frameworks/full-stack/nextjs'
          : framework === 'vite'
            ? 'https://vite.dev/guide/static-deploy.html'
            : 'https://vercel.com/docs/deployments',
    },
  };
}
