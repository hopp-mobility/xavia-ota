import { NextApiRequest, NextApiResponse } from 'next';

import { clearSessionCookie } from '../../apiUtils/auth/session';

export default async function logoutEndpoint(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  clearSessionCookie(res);
  res.status(200).json({ success: true });
}
