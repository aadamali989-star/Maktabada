import { onRequest as handleR2Request } from './functions/api/r2-storage/[[route]].js';
import { onRequest as handleGitHubRequest } from './functions/api/github-host/[[route]].js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/r2-storage')) {
      return handleR2Request({ request, env, ctx });
    }

    if (url.pathname.startsWith('/api/github-host')) {
      return handleGitHubRequest({ request, env, ctx });
    }

    if (env?.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  },
};
