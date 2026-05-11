import formidable from 'formidable';
import fs from 'fs';
import moment from 'moment';
import { NextApiRequest, NextApiResponse } from 'next';

import { verifySession } from '../../apiUtils/auth/session';
import { DatabaseFactory } from '../../apiUtils/database/DatabaseFactory';
import { StorageFactory } from '../../apiUtils/storage/StorageFactory';

import AdmZip from 'adm-zip';
import { ZipHelper } from '../../apiUtils/helpers/ZipHelper';
import { HashHelper } from '../../apiUtils/helpers/HashHelper';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function uploadHandler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const form = formidable({});

  try {
    const [fields, files] = await form.parse(req);
    const uploadKey = fields.uploadKey?.[0] || null;
    const file = files.file?.[0];
    const runtimeVersion = fields.runtimeVersion?.[0];
    const commitHash = fields.commitHash?.[0];
    const commitMessage = fields.commitMessage?.[0] || 'No message provided';
    const updateGroupName = fields.updateGroup?.[0];

    if (!file || !runtimeVersion || !commitHash) {
      res.status(400).json({ error: 'Missing file, runtime version or commit hash' });
      return;
    }

    // Authorize: dashboard session OR matching UPLOAD_KEY (for CI/CD).
    const sessionOk = verifySession(req);
    const uploadKeyOk = !!uploadKey && process.env.UPLOAD_KEY === uploadKey;
    if (!sessionOk && !uploadKeyOk) {
      res.status(401).json({ error: 'Authentication required: provide a session or upload key' });
      return;
    }

    const database = DatabaseFactory.getDatabase();
    let updateGroup;
    if (updateGroupName) {
      updateGroup = await database.getUpdateGroupByName(updateGroupName);
      if (!updateGroup) {
        res.status(400).json({ error: `Unknown update group: ${updateGroupName}` });
        return;
      }
    } else {
      updateGroup = await database.getDefaultUpdateGroup();
    }

    const storage = StorageFactory.getStorage();
    const timestamp = moment().utc().format('YYYYMMDDHHmmss');
    const updatePath = `updates/${runtimeVersion}`;

    const zipContent = fs.readFileSync(file.filepath);
    const zipFolder = new AdmZip(file.filepath);
    const metadataJsonFile = await ZipHelper.getFileFromZip(zipFolder, 'metadata.json');

    const updateHash = HashHelper.createHash(metadataJsonFile, 'sha256', 'hex');
    const updateId = HashHelper.convertSHA256HashToUUID(updateHash);

    const path = await storage.uploadFile(`${updatePath}/${timestamp}.zip`, zipContent);

    await database.createRelease({
      path,
      runtimeVersion,
      timestamp: moment().utc().toString(),
      commitHash,
      commitMessage,
      updateId,
      updateGroupId: updateGroup.id,
    });

    res.status(200).json({ success: true, path });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
}
