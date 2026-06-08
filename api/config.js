// Serves window.GMAPS_KEY to the deployed client from a server-side env var, so the Google
// Maps key never lives in the (public) repo. In production a /config.js rewrite (vercel.json)
// points here; locally the static, gitignored config.js is used instead. The key is a client
// key either way — protect it with an HTTP-referrer restriction in Google Cloud Console.
export default function handler(req, res) {
  const key = process.env.GMAPS_KEY || '';
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send('window.GMAPS_KEY=' + JSON.stringify(key) + ';');
}
