import crypto from 'crypto';
import moment from 'moment';
import { NextApiRequest, NextApiResponse } from 'next';

import { requireSession } from '../../apiUtils/auth/session';
import { DatabaseFactory } from '../../apiUtils/database/DatabaseFactory';
import { getLogger } from '../../apiUtils/logger';

const logger = getLogger('rollback');

// Rollback = "republish an older release". We create a new row whose
// `manifest_data` is copied from the source release, so it references the
// same R2 storage keys. No file copies — the assets the clients downloaded
// for the source are reused as-is for the new row.
//
// The new row gets a fresh `updateId` even though the content is identical.
// Expo treats updateId as the cache key: clients that already ran the
// source release would see the same id and `noUpdateAvailable`, which
// defeats the point of rolling back.
export default async function rollbackHandler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!requireSession(req, res)) return;

  const {
    path: sourcePath,
    runtimeVersion,
    commitHash,
    commitMessage,
    updateGroup: overrideGroupName,
  } = req.body;

  if (!sourcePath) {
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

    const sourceRelease = await database.getReleaseByPath(sourcePath);
    if (!sourceRelease) {
      res.status(404).json({ error: 'Source release not found' });
      return;
    }

    let updateGroupId: string;
    if (overrideGroupName) {
      const overrideGroup = await database.getUpdateGroupByName(overrideGroupName);
      if (!overrideGroup) {
        res.status(400).json({ error: `Unknown update group: ${overrideGroupName}` });
        return;
      }
      updateGroupId = overrideGroup.id;
    } else {
      updateGroupId = sourceRelease.updateGroupId;
    }

    const newReleaseId = crypto.randomUUID();
    const newPath = `releases/${newReleaseId}`;

    await database.createRelease({
      id: newReleaseId,
      path: newPath,
      runtimeVersion,
      timestamp: moment().utc().toString(),
      commitHash,
      commitMessage,
      updateId: crypto.randomUUID(),
      updateGroupId,
      manifestData: sourceRelease.manifestData,
    });

    res.status(200).json({ success: true, path: newPath, releaseId: newReleaseId });
  } catch (error) {
    logger.error('Rollback error', { error });
    res.status(500).json({ error: 'Rollback failed' });
  }
}
