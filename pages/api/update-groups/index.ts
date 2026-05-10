import { NextApiRequest, NextApiResponse } from 'next';

import { DatabaseFactory } from '../../../apiUtils/database/DatabaseFactory';
import { getLogger } from '../../../apiUtils/logger';

const logger = getLogger('updateGroups');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = DatabaseFactory.getDatabase();

  if (req.method === 'GET') {
    try {
      const groups = await db.listUpdateGroups();
      res.status(200).json({ groups });
    } catch (error) {
      logger.error(error);
      res.status(500).json({ error: 'Failed to list update groups' });
    }
    return;
  }

  if (req.method === 'POST') {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) {
      res.status(400).json({ error: 'Missing or empty `name`' });
      return;
    }
    try {
      const group = await db.createUpdateGroup(name);
      res.status(201).json({ group });
    } catch (error) {
      logger.error(error);
      res.status(500).json({ error: 'Failed to create update group' });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
