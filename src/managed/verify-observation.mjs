// Server-side health alone does not prove a browser can write feedback or read reports.
export async function verifyObservationPreflight(apiBase, origin, fetcher = fetch) {
  for (const [path, method, header] of [['/sessions', 'POST', 'content-type'], ['/events', 'POST', 'authorization,content-type'], ['/feedback', 'POST', 'authorization,content-type'], ['/report', 'GET', 'authorization']]) {
    const response = await fetcher(apiBase + path, { method: 'OPTIONS', headers: {
      Origin: origin, 'Access-Control-Request-Method': method, 'Access-Control-Request-Headers': header,
    }, redirect: 'error', signal: AbortSignal.timeout(15000) });
    const allowed = (name) => (response.headers.get(name) || '').toLowerCase().split(',').map((s) => s.trim());
    if (!response.ok || response.headers.get('access-control-allow-origin') !== origin
      || !allowed('access-control-allow-methods').includes(method.toLowerCase())
      || !header.split(',').every((h) => allowed('access-control-allow-headers').includes(h))) {
      throw new Error(`Browser access to the observation service failed preflight: ${path}.`);
    }
  }
}
