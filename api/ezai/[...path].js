/**
 * Vercel Serverless Function - EzAI API Proxy
 * 
 * This catch-all route proxies requests from /api/ezai/* to https://ezaiapi.com/v1/*
 * Replaces the Vite dev server proxy that only works locally.
 * 
 * Benefits:
 * - No CORS issues (server-to-server call)
 * - Custom headers forwarded correctly
 * - Works in production on Vercel
 */

export default async function handler(req, res) {
  // Only allow POST
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, anthropic-version, User-Agent');
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Extract the path after /api/ezai/
  const { path } = req.query;
  const targetPath = Array.isArray(path) ? path.join('/') : path || '';
  const targetUrl = `https://ezaiapi.com/v1/${targetPath}`;

  try {
    // Forward the request to EzAI API
    const headers = {
      'Content-Type': 'application/json',
    };

    // Forward relevant headers from the client request
    if (req.headers['x-api-key']) {
      headers['x-api-key'] = req.headers['x-api-key'];
    }
    if (req.headers['anthropic-version']) {
      headers['anthropic-version'] = req.headers['anthropic-version'];
    }

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(req.body),
    });

    const data = await response.json();

    // Set CORS headers for the response
    res.setHeader('Access-Control-Allow-Origin', '*');

    return res.status(response.status).json(data);
  } catch (error) {
    console.error('EzAI Proxy Error:', error);
    return res.status(502).json({
      error: {
        message: `Proxy error: ${error.message}`,
        type: 'proxy_error',
      },
    });
  }
}
