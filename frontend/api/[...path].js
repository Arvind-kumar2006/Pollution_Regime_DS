/**
 * Vercel serverless catch-all proxy → EC2 backend.
 * Handles ALL HTTP methods including PUT and DELETE which Vercel's
 * external URL rewrites block.
 *
 * Route: /api/* → this function → http://3.93.196.160:8000/*
 */

const EC2 = 'http://3.93.196.160:8000';

export default async function handler(req, res) {
  try {
    // Build backend path from Vercel's catch-all query param
    const segs = [].concat(req.query.path || []);
    const backendPath = segs.join('/');

    // Rebuild query string, excluding Vercel's internal 'path' param
    const qp = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query || {})) {
      if (k === 'path') continue;
      for (const val of [].concat(v)) qp.append(k, val);
    }
    const qs = qp.toString();
    const url = `${EC2}/${backendPath}${qs ? '?' + qs : ''}`;

    console.log(`[PROXY] ${req.method} ${url}`);

    // Forward headers — drop hop-by-hop headers
    const fwdHeaders = {};
    for (const [k, v] of Object.entries(req.headers || {})) {
      const lower = k.toLowerCase();
      if (!['host', 'connection', 'transfer-encoding'].includes(lower)) {
        fwdHeaders[k] = v;
      }
    }

    // Read request body for non-GET/HEAD requests
    let body;
    if (!['GET', 'HEAD'].includes(req.method)) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      if (chunks.length) body = Buffer.concat(chunks);
    }

    // Proxy to EC2 — fetch follows redirects (handles FastAPI trailing-slash redirects)
    const upstream = await fetch(url, {
      method: req.method,
      headers: fwdHeaders,
      body,
      redirect: 'follow',
    });

    // Forward response status
    res.statusCode = upstream.status;

    // Forward response headers
    upstream.headers.forEach((v, k) => {
      const lower = k.toLowerCase();
      if (!['content-encoding', 'transfer-encoding', 'connection'].includes(lower)) {
        res.setHeader(k, v);
      }
    });

    // Forward response body
    const buf = await upstream.arrayBuffer();
    res.end(Buffer.from(buf));

  } catch (err) {
    console.error('[PROXY ERROR]', String(err));
    res.statusCode = 502;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Proxy error', detail: String(err) }));
  }
}
