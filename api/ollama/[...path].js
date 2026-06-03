const OLLAMA_API_BASE_URL = 'https://ollama.com/v1';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { path } = req.query;
  const targetPath = Array.isArray(path) ? path.join('/') : path || '';
  const targetUrl = `${OLLAMA_API_BASE_URL}/${targetPath}`;

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}),
      },
      body: JSON.stringify(req.body),
    });

    const textBody = await response.text();
    let data;
    try {
      data = JSON.parse(textBody);
    } catch {
      data = {
        error: `Upstream error (${response.status}): ${textBody.substring(0, 150)}...`,
      };
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    if (response.headers.get('retry-after')) {
      res.setHeader('Retry-After', response.headers.get('retry-after'));
    }

    return res.status(response.status).json(data);
  } catch (error) {
    console.error('Ollama proxy error:', error);
    return res.status(502).json({
      error: `Proxy error: ${error.message}`,
    });
  }
}
