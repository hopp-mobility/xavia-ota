import { NextApiRequest, NextApiResponse } from 'next';

// Liveness probe for hosting platforms (Render, etc.). Always returns 200
// if the Node process is up. Intentionally does not hit the database or
// storage so a transient downstream outage doesn't cycle the app instance.
export default function healthEndpoint(_req: NextApiRequest, res: NextApiResponse) {
  res.status(200).json({ status: 'ok' });
}
