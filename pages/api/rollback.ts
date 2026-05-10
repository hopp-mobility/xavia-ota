import moment from 'moment';
import { NextApiRequest, NextApiResponse } from 'next';

import { requireSession } from '../../apiUtils/auth/session';
import { DatabaseFactory } from '../../apiUtils/database/DatabaseFactory';
import { StorageFactory } from '../../apiUtils/storage/StorageFactory';

export default async function rollbackHandler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!requireSession(req, res)) return;

  const {
    path,
    runtimeVersion,
    commitHash,
    commitMessage,
    updateGroup: overrideGroupName,
  } = req.body;

  if (!path) {
    res.status(400).json({ error: 'Missing path' });
    return;
  }
  if (!runtimeVersion) {
    res.status(400).json({ error: 'Missing runtimeVersion' });
    return;
  }
  if (!commitHash) {
    res.status(400).json({ error: 'Missing commitHash' });
    return;
  }

  try {
    const database = DatabaseFactory.getDatabase();
    const storage = StorageFactory.getStorage();

    let updateGroupId: string;
    if (overrideGroupName) {
      const overrideGroup = await database.getUpdateGroupByName(overrideGroupName);
      if (!overrideGroup) {
        res.status(400).json({ error: `Unknown update group: ${overrideGroupName}` });
        return;
      }
      updateGroupId = overrideGroup.id;
    } else {
      const sourceRelease = await database.getReleaseByPath(path);
      if (sourceRelease?.updateGroupId) {
        updateGroupId = sourceRelease.updateGroupId;
      } else {
        const defaultGroup = await database.getDefaultUpdateGroup();
        updateGroupId = defaultGroup.id;
      }
    }

    const timestamp = moment().utc().format('YYYYMMDDHHmmss');
    const newPath = `updates/${runtimeVersion}/${timestamp}.zip`;

    await storage.copyFile(path, newPath);

    await database.createRelease({
      path: newPath,
      runtimeVersion,
      timestamp: moment().utc().toString(),
      commitHash,
      commitMessage,
      updateGroupId,
    });

    res.status(200).json({ success: true, newPath });
  } catch (error) {
    console.error('Rollback error:', error);
    res.status(500).json({ error: 'Rollback failed' });
  }
}
