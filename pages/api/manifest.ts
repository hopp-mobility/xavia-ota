import FormData from 'form-data';
import moment from 'moment';

import { NextApiRequest, NextApiResponse } from 'next';
import { parseDictionary, serializeDictionary } from 'structured-headers';

import { ConfigHelper } from '../../apiUtils/helpers/ConfigHelper';
import { DictionaryHelper } from '../../apiUtils/helpers/DictionaryHelper';
import { HashHelper } from '../../apiUtils/helpers/HashHelper';
import { UpdateHelper } from '../../apiUtils/helpers/UpdateHelper';
import { getLogger } from '../../apiUtils/logger';
import { DatabaseFactory } from '../../apiUtils/database/DatabaseFactory';
import { AssetEntry, PlatformBundle } from '../../apiUtils/database/DatabaseInterface';

const logger = getLogger('manifest');

// Expo-Extra-Params is an RFC 8941 structured-headers dictionary with string
// values, e.g. `xavia-user-id="abc123", another-key="x"`. Set on the client
// via `Updates.setExtraParamAsync(key, value)`.
function extractExtraParam(req: NextApiRequest, key: string): string | null {
  const header = req.headers['expo-extra-params'];
  if (typeof header !== 'string' || header.length === 0) return null;
  try {
    const entry = parseDictionary(header).get(key);
    if (!entry) return null;
    const [bareItem] = entry;
    return typeof bareItem === 'string' && bareItem.length > 0 ? bareItem : null;
  } catch (error) {
    logger.warn('Failed to parse Expo-Extra-Params', { error });
    return null;
  }
}

export default async function manifestEndpoint(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.json({ error: 'Expected GET.' });
    return;
  }

  const userId = extractExtraParam(req, 'xavia-user-id');

  logger.info('A client requested a release', {
    runtimeVersion: req.headers['expo-runtime-version'],
    platform: req.headers['expo-platform'],
    protocolVersion: req.headers['expo-protocol-version'],
    apiVersion: req.headers['expo-api-version'],
    currentUpdateId: req.headers['expo-current-update-id'],
    userId,
  });

  const protocolVersionMaybeArray = req.headers['expo-protocol-version'];
  if (protocolVersionMaybeArray && Array.isArray(protocolVersionMaybeArray)) {
    res.statusCode = 400;
    res.json({ error: 'Unsupported protocol version. Expected either 0 or 1.' });
    return;
  }
  const protocolVersion = parseInt(protocolVersionMaybeArray ?? '0', 10);

  const platform = req.headers['expo-platform'] ?? req.query['platform'];
  if (platform !== 'ios' && platform !== 'android') {
    res.statusCode = 400;
    res.json({ error: 'Unsupported platform. Expected either ios or android.' });
    return;
  }

  const runtimeVersion = req.headers['expo-runtime-version'] ?? req.query['runtime-version'];
  if (!runtimeVersion || typeof runtimeVersion !== 'string') {
    res.statusCode = 400;
    res.json({ error: 'No runtimeVersion provided.' });
    return;
  }

  if (!process.env.ASSET_BASE_URL) {
    logger.error('ASSET_BASE_URL is not configured; cannot emit asset URLs');
    res.statusCode = 500;
    res.json({ error: 'Server misconfiguration: ASSET_BASE_URL is not set.' });
    return;
  }

  const database = DatabaseFactory.getDatabase();
  const releaseRecord = await database.getLatestReleaseForUser(runtimeVersion, userId);

  const bundle: PlatformBundle | undefined = releaseRecord?.manifestData?.[platform];
  if (!releaseRecord || !bundle) {
    logger.info('No update available for runtime version', { runtimeVersion, userId, platform });
    try {
      await putNoUpdateAvailableInResponseAsync(req, res, protocolVersion);
    } catch (error: any) {
      res.statusCode = 404;
      res.json({ error: error.message });
    }
    return;
  }

  const currentUpdateId = req.headers['expo-current-update-id'];
  if (currentUpdateId && currentUpdateId === releaseRecord.updateId) {
    logger.info('User is already running the latest release. Returning NoUpdateAvailable.', {
      runtimeVersion,
      userId,
    });
    try {
      await putNoUpdateAvailableInResponseAsync(req, res, protocolVersion);
    } catch (error: any) {
      res.statusCode = 404;
      res.json({ error: error.message });
    }
    return;
  }

  try {
    await putUpdateInResponseAsync(
      req,
      res,
      releaseRecord.id,
      releaseRecord.updateId!,
      bundle,
      runtimeVersion,
      platform,
      protocolVersion
    );
  } catch (error) {
    logger.error('Failed to write manifest response', { error });
    res.statusCode = 404;
    res.json({ error });
  }
}

function toManifestAsset(asset: AssetEntry) {
  return {
    hash: asset.hash,
    key: asset.key,
    fileExtension: asset.fileExtension,
    contentType: asset.contentType,
    url: `${process.env.ASSET_BASE_URL}/${asset.storageKey}`,
  };
}

async function putUpdateInResponseAsync(
  req: NextApiRequest,
  res: NextApiResponse,
  releaseId: string,
  updateId: string,
  bundle: PlatformBundle,
  runtimeVersion: string,
  platform: string,
  protocolVersion: number
): Promise<void> {
  const manifest = {
    id: updateId,
    createdAt: new Date().toISOString(),
    runtimeVersion,
    assets: bundle.assets.map(toManifestAsset),
    launchAsset: toManifestAsset(bundle.launchAsset),
    metadata: {},
    extra: { expoClient: bundle.expoConfig },
  };

  let signature = null;
  const expectSignatureHeader = req.headers['expo-expect-signature'];
  if (expectSignatureHeader) {
    const privateKey = ConfigHelper.getPrivateKey();
    if (!privateKey) {
      res.statusCode = 400;
      res.json({
        error: 'Code signing requested but no key supplied when starting server.',
      });
      return;
    }
    const manifestString = JSON.stringify(manifest);
    const hashSignature = HashHelper.signRSASHA256(manifestString, privateKey);
    const dictionary = DictionaryHelper.convertToDictionaryItemsRepresentation({
      sig: hashSignature,
      keyid: 'main',
    });
    signature = serializeDictionary(dictionary);
  }

  const assetRequestHeaders: { [key: string]: object } = {};
  [...manifest.assets, manifest.launchAsset].forEach((asset) => {
    assetRequestHeaders[asset.key] = { 'test-header': 'test-header-value' };
  });

  const form = new FormData();
  form.append('manifest', JSON.stringify(manifest), {
    contentType: 'application/json',
    header: {
      'content-type': 'application/json; charset=utf-8',
      ...(signature ? { 'expo-signature': signature } : {}),
    },
  });
  form.append('extensions', JSON.stringify({ assetRequestHeaders }), {
    contentType: 'application/json',
  });

  res.statusCode = 200;
  res.setHeader('expo-protocol-version', protocolVersion);
  res.setHeader('expo-sfv-version', 0);
  res.setHeader('cache-control', 'private, max-age=0');
  res.setHeader('content-type', `multipart/mixed; boundary=${form.getBoundary()}`);
  res.write(form.getBuffer());
  res.end();

  logger.info('Tracking download for release.', { releaseId });
  await DatabaseFactory.getDatabase().createTracking({
    platform,
    releaseId,
    downloadTimestamp: moment().utc().toISOString(),
  });
}

async function putNoUpdateAvailableInResponseAsync(
  req: NextApiRequest,
  res: NextApiResponse,
  protocolVersion: number
): Promise<void> {
  if (protocolVersion === 0) {
    throw new Error('NoUpdateAvailable directive not available in protocol version 0');
  }

  const directive = await UpdateHelper.createNoUpdateAvailableDirectiveAsync();

  let signature = null;
  const expectSignatureHeader = req.headers['expo-expect-signature'];
  if (expectSignatureHeader) {
    const privateKey = ConfigHelper.getPrivateKey();
    if (!privateKey) {
      res.statusCode = 400;
      res.json({
        error: 'Code signing requested but no key supplied when starting server.',
      });
      return;
    }
    const directiveString = JSON.stringify(directive);
    const hashSignature = HashHelper.signRSASHA256(directiveString, privateKey);
    const dictionary = DictionaryHelper.convertToDictionaryItemsRepresentation({
      sig: hashSignature,
      keyid: 'main',
    });
    signature = serializeDictionary(dictionary);
  }

  const form = new FormData();
  form.append('directive', JSON.stringify(directive), {
    contentType: 'application/json',
    header: {
      'content-type': 'application/json; charset=utf-8',
      ...(signature ? { 'expo-signature': signature } : {}),
    },
  });

  res.statusCode = 200;
  res.setHeader('expo-protocol-version', 1);
  res.setHeader('expo-sfv-version', 0);
  res.setHeader('cache-control', 'private, max-age=0');
  res.setHeader('content-type', `multipart/mixed; boundary=${form.getBoundary()}`);
  res.write(form.getBuffer());
  res.end();
}
