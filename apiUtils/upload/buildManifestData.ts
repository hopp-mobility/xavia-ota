import AdmZip from 'adm-zip';
import mime from 'mime';

import { AssetEntry, ManifestData, PlatformBundle } from '../database/DatabaseInterface';
import { HashHelper } from '../helpers/HashHelper';
import { ZipHelper } from '../helpers/ZipHelper';
import { StorageFactory } from '../storage/StorageFactory';

type AssetDescriptor = { path: string; ext: string };
type PlatformMetadata = { assets: AssetDescriptor[]; bundle: string };
type MetadataJson = { fileMetadata: Partial<Record<'ios' | 'android', PlatformMetadata>> };

const PLATFORMS = ['ios', 'android'] as const;
type Platform = (typeof PLATFORMS)[number];

// Unpack the uploaded zip and upload each asset to storage with the right
// Content-Type, returning the precomputed manifest data the server will hand
// back at /api/manifest time (no more downloading the zip per request).
export async function buildManifestData(
  zip: AdmZip,
  metadataJson: MetadataJson,
  expoConfig: unknown,
  releaseId: string
): Promise<ManifestData> {
  const storage = StorageFactory.getStorage();
  const result: ManifestData = {};

  await Promise.all(
    PLATFORMS.map(async (platform) => {
      const platformMeta = metadataJson.fileMetadata[platform];
      if (!platformMeta) return;

      const launchAsset = await uploadAsset({
        zip,
        storage,
        releaseId,
        platform,
        filePath: platformMeta.bundle,
        ext: 'bundle',
        isLaunchAsset: true,
      });

      const assets = await Promise.all(
        platformMeta.assets.map((asset) =>
          uploadAsset({
            zip,
            storage,
            releaseId,
            platform,
            filePath: asset.path,
            ext: asset.ext,
            isLaunchAsset: false,
          })
        )
      );

      const bundle: PlatformBundle = { assets, launchAsset, expoConfig };
      result[platform] = bundle;
    })
  );

  return result;
}

async function uploadAsset({
  zip,
  storage,
  releaseId,
  platform,
  filePath,
  ext,
  isLaunchAsset,
}: {
  zip: AdmZip;
  storage: ReturnType<typeof StorageFactory.getStorage>;
  releaseId: string;
  platform: Platform;
  filePath: string;
  ext: string;
  isLaunchAsset: boolean;
}): Promise<AssetEntry> {
  const bytes = await ZipHelper.getFileFromZip(zip, filePath);

  const hash = HashHelper.getBase64URLEncoding(HashHelper.createHash(bytes, 'sha256', 'base64'));
  const key = HashHelper.createHash(bytes, 'md5', 'hex');
  const contentType = isLaunchAsset
    ? 'application/javascript'
    : mime.getType(ext) ?? 'application/octet-stream';
  const fileExtension = `.${isLaunchAsset ? 'bundle' : ext}`;
  const storageKey = `releases/${releaseId}/${platform}/${filePath}`;

  await storage.uploadFile(storageKey, bytes, { contentType });

  return { filePath, storageKey, hash, key, fileExtension, contentType };
}
