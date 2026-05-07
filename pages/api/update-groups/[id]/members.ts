import { NextApiRequest, NextApiResponse } from 'next';

import { DatabaseFactory } from '../../../../apiUtils/database/DatabaseFactory';
import { getLogger } from '../../../../apiUtils/logger';

const logger = getLogger('updateGroupMembers');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  if (typeof id !== 'string') {
    res.status(400).json({ error: 'Missing id' });
    return;
  }

  const db = DatabaseFactory.getDatabase();
  const group = await db.getUpdateGroup(id);
  if (!group) {
    res.status(404).json({ error: 'Update group not found' });
    return;
  }

  if (req.method === 'GET') {
    try {
      const members = await db.listGroupMembers(id);
      res.status(200).json({ members });
    } catch (error) {
      logger.error(error);
      res.status(500).json({ error: 'Failed to list members' });
    }
    return;
  }

  if (req.method === 'POST') {
    if (group.isDefault) {
      res.status(400).json({
        error: 'The default group has implicit membership and cannot have explicit members',
      });
      return;
    }
    const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
    if (!userId) {
      res.status(400).json({ error: 'Missing or empty `userId`' });
      return;
    }
    const label =
      typeof req.body?.label === 'string' ? req.body.label.trim() || undefined : undefined;
    try {
      await db.addUserToGroup(id, userId, label);
      res.status(204).end();
    } catch (error) {
      logger.error(error);
      res.status(500).json({ error: 'Failed to add member' });
    }
    return;
  }

  if (req.method === 'DELETE') {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
    if (!userId) {
      res.status(400).json({ error: 'Missing `userId` query parameter' });
      return;
    }
    try {
      await db.removeUserFromGroup(id, userId);
      res.status(204).end();
    } catch (error) {
      logger.error(error);
      res.status(500).json({ error: 'Failed to remove member' });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
