export interface Env {
  ASSETS: Fetcher;
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(init.headers ?? {}),
    },
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({
        ok: true,
        service: 'fantasy-edge',
        platform: 'cloudflare-workers',
        storage: 'not-configured',
      });
    }

    if (url.pathname.startsWith('/api/')) {
      return json(
        { ok: false, error: 'Not found' },
        { status: 404 },
      );
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
