import { NextApiRequest, NextApiResponse } from 'next';

import { requireSession } from '../../../apiUtils/auth/session';
import { DatabaseFactory } from '../../../apiUtils/database/DatabaseFactory';
import { getLogger } from '../../../apiUtils/logger';

const logger = getLogger('updateGroup');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireSession(req, res)) return;
  const { id } = req.query;
  if (typeof id !== 'string') {
    res.status(400).json({ error: 'Missing id' });
    return;
  }

  const db = DatabaseFactory.getDatabase();

  if (req.method === 'DELETE') {
    try {
      const group = await db.getUpdateGroup(id);
      if (!group) {
        res.status(404).json({ error: 'Update group not found' });
        return;
      }
      if (group.isDefault) {
        res.status(400).json({ error: 'Cannot delete the default update group' });
        return;
      }
      await db.deleteUpdateGroup(id);
      res.status(204).end();
    } catch (error) {
      logger.error(error);
      res.status(500).json({ error: 'Failed to delete update group' });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
