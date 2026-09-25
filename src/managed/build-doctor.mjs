// Runs inside CodeBuild. Only this bounded planner may change package metadata.
export const ALLOWED_PACKAGES = ['vite', '@vitejs/plugin-react', '@vitejs/plugin-vue', 'typescript'];
const version = (value) => typeof value === 'string' && value.match(/^[~^]?(\d+)\.(\d+)\.(\d+)$/);
export function chooseUpdate(current, candidates) {
  const from = version(current);
  if (!from) return null;
  const newer = (v) => { const parts = v.split('.').map(Number); return parts[1] > Number(from[2]) || (parts[1] === Number(from[2]) && parts[2] >= Number(from[3])); };
  return candidates.filter((v) => /^\d+\.\d+\.\d+$/.test(v) && v.split('.')[0] === from[1] && newer(v))
    .sort((a, b) => { const aa = a.split('.').map(Number), bb = b.split('.').map(Number); return aa[0] - bb[0] || aa[1] - bb[1] || aa[2] - bb[2]; }).at(-1) || null;
}
export function repairPlan(pkg, hasLock, policy, versions = {}) {
  const next = structuredClone(pkg), changes = [];
  if (!policy.allowRepairs) return { next, changes, regenerateLock: false };
  if (!pkg.scripts?.build && (pkg.devDependencies?.vite || pkg.dependencies?.vite)) {
    next.scripts = { ...next.scripts, build: 'vite build' };
    changes.push({ type: 'build_script', reason: 'Vite dependency exists but the build command is missing.', to: 'vite build' });
  }
  if (policy.refreshBuildPackages) {
    for (const name of ALLOWED_PACKAGES) {
      const section = pkg.devDependencies?.[name] ? 'devDependencies' : pkg.dependencies?.[name] ? 'dependencies' : null;
      if (!section) continue;
      const to = chooseUpdate(pkg[section][name], versions[name] || []);
      if (to && to !== pkg[section][name]) {
        next[section][name] = to;
        changes.push({ type: 'package_update', name, from: pkg[section][name], to, reason: 'Explicitly allowed stable build-tool refresh within its current major version.' });
      }
    }
  }
  const regenerateLock = !hasLock || changes.some((x) => x.type === 'package_update');
  if (!hasLock) changes.push({ type: 'lockfile', reason: 'Generate an npm lockfile in the disposable build workspace.' });
  return { next, changes, regenerateLock };
}
