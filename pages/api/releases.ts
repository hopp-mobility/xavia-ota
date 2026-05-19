import { NextApiRequest, NextApiResponse } from 'next';

import { requireSession } from '../../apiUtils/auth/session';
import { DatabaseFactory } from '../../apiUtils/database/DatabaseFactory';
import { getLogger } from '../../apiUtils/logger';

const logger = getLogger('releases');

export default async function releasesHandler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!requireSession(req, res)) return;

  try {
    const rows = await DatabaseFactory.getDatabase().listReleases();
    const releases = rows.map((r) => ({
      path: r.path,
      runtimeVersion: r.runtimeVersion,
      timestamp: r.timestamp,
      commitHash: r.commitHash,
      commitMessage: r.commitMessage,
      updateId: r.updateId,
      updateGroupId: r.updateGroupId,
      updateGroupName: r.updateGroupName,
    }));
    res.status(200).json({ releases });
  } catch (error) {
    logger.error('Failed to fetch releases', { error });
    res.status(500).json({ error: 'Failed to fetch releases' });
  }
}
