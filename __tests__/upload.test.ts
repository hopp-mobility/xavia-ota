import AdmZip from 'adm-zip';
import formidable from 'formidable';
import fs from 'fs';
import { createMocks } from 'node-mocks-http';

import { DatabaseFactory } from '../apiUtils/database/DatabaseFactory';
import { StorageFactory } from '../apiUtils/storage/StorageFactory';
import { ZipHelper } from '../apiUtils/helpers/ZipHelper';
import { HashHelper } from '../apiUtils/helpers/HashHelper';
import uploadHandler from '../pages/api/upload';
import { authedCookies } from './helpers/session';

jest.mock('../apiUtils/database/DatabaseFactory');
jest.mock('../apiUtils/storage/StorageFactory');
jest.mock('../apiUtils/helpers/ZipHelper');
jest.mock('../apiUtils/helpers/HashHelper');
jest.mock('formidable');
jest.mock('adm-zip');

const FAKE_UPLOAD_KEY = 'ci-upload-key';

const METADATA_JSON = {
  fileMetadata: {
    ios: {
      bundle: 'bundle.js',
      assets: [{ path: 'icon.png', ext: 'png' }],
    },
  },
};

function arrange({
  fields,
  hasFile = true,
  metadata = METADATA_JSON,
  hasExpoConfig = true,
}: {
  fields?: Record<string, string[] | undefined>;
  hasFile?: boolean;
  metadata?: typeof METADATA_JSON;
  hasExpoConfig?: boolean;
} = {}) {
  const mockForm = {
    parse: jest.fn().mockResolvedValue([
      {
        uploadKey: [FAKE_UPLOAD_KEY],
        runtimeVersion: ['1.0.0'],
        commitHash: ['abc123'],
        commitMessage: ['Test commit'],
        ...fields,
      },
      hasFile ? { file: [{ filepath: 'test.zip' }] } : {},
    ]),
  };
  (formidable as unknown as jest.Mock).mockReturnValue(mockForm);

  (AdmZip as unknown as jest.Mock).mockImplementation(() => ({}));

  (ZipHelper.getFileFromZip as jest.Mock).mockImplementation(
    (_zip: unknown, filePath: string): Buffer => {
      if (filePath === 'metadata.json') return Buffer.from(JSON.stringify(metadata));
      if (filePath === 'expoconfig.json') {
        if (!hasExpoConfig) throw new Error('not found');
        return Buffer.from(JSON.stringify({ name: 'app' }));
      }
      return Buffer.from(`${filePath}-bytes`);
    }
  );

  (HashHelper.createHash as jest.Mock).mockReturnValue('hash');
  (HashHelper.getBase64URLEncoding as jest.Mock).mockReturnValue('hashb64');
  (HashHelper.convertSHA256HashToUUID as jest.Mock).mockReturnValue('update-id-uuid');

  const uploadFile = jest.fn().mockImplementation((path: string) => Promise.resolve(path));
  (StorageFactory.getStorage as jest.Mock).mockReturnValue({ uploadFile });

  const unlinkSync = jest.spyOn(fs, 'unlinkSync').mockImplementation(() => undefined);

  return { uploadFile, unlinkSync };
}

function mockDefaultGroupDatabase() {
  const createRelease = jest.fn().mockResolvedValue({});
  (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue({
    getDefaultUpdateGroup: jest
      .fn()
      .mockResolvedValue({ id: 'g-prod', name: 'production', isDefault: true, createdAt: 't' }),
    createRelease,
  });
  return { createRelease };
}

describe('Upload API', () => {
  const originalUploadKey = process.env.UPLOAD_KEY;
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.UPLOAD_KEY = FAKE_UPLOAD_KEY;
  });
  afterAll(() => {
    process.env.UPLOAD_KEY = originalUploadKey;
  });

  it('returns 405 for non-POST requests', async () => {
    const { req, res } = createMocks({ method: 'GET' });
    await uploadHandler(req, res);
    expect(res._getStatusCode()).toBe(405);
  });

  it('returns 400 when required fields are missing', async () => {
    const mockForm = { parse: jest.fn().mockResolvedValue([{}, {}]) };
    (formidable as unknown as jest.Mock).mockReturnValue(mockForm);

    const { req, res } = createMocks({ method: 'POST' });
    await uploadHandler(req, res);
    expect(res._getStatusCode()).toBe(400);
  });

  it('uploads each asset under releases/<id>/<platform>/... with correct content types', async () => {
    const { uploadFile } = arrange();

    const createRelease = jest.fn().mockResolvedValue({});
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue({
      getDefaultUpdateGroup: jest
        .fn()
        .mockResolvedValue({ id: 'g-prod', name: 'production', isDefault: true, createdAt: 't' }),
      createRelease,
    });

    const { req, res } = createMocks({ method: 'POST' });
    await uploadHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const calls = uploadFile.mock.calls;
    const launchCall = calls.find((c) => c[0].endsWith('/ios/bundle.js'));
    const iconCall = calls.find((c) => c[0].endsWith('/ios/icon.png'));
    expect(launchCall).toBeDefined();
    expect(iconCall).toBeDefined();
    expect(launchCall![2]).toEqual({ contentType: 'application/javascript' });
    expect(iconCall![2]).toEqual({ contentType: 'image/png' });

    expect(createRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        runtimeVersion: '1.0.0',
        path: expect.stringMatching(/^releases\//),
        commitHash: 'abc123',
        commitMessage: 'Test commit',
        updateId: 'update-id-uuid',
        updateGroupId: 'g-prod',
        manifestData: expect.objectContaining({
          ios: expect.objectContaining({
            launchAsset: expect.objectContaining({
              storageKey: expect.stringMatching(/\/ios\/bundle\.js$/),
              contentType: 'application/javascript',
            }),
            assets: expect.arrayContaining([
              expect.objectContaining({
                storageKey: expect.stringMatching(/\/ios\/icon\.png$/),
                contentType: 'image/png',
              }),
            ]),
            expoConfig: { name: 'app' },
          }),
        }),
      })
    );
  });

  it('routes uploads to the named update group when provided', async () => {
    arrange({ fields: { updateGroup: ['beta'] } });

    const createRelease = jest.fn().mockResolvedValue({});
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue({
      getUpdateGroupByName: jest
        .fn()
        .mockResolvedValue({ id: 'g-beta', name: 'beta', isDefault: false, createdAt: 't' }),
      getDefaultUpdateGroup: jest.fn(),
      createRelease,
    });

    const { req, res } = createMocks({ method: 'POST' });
    await uploadHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(createRelease).toHaveBeenCalledWith(
      expect.objectContaining({ updateGroupId: 'g-beta' })
    );
  });

  it('rejects unknown update groups with 400', async () => {
    arrange({ fields: { updateGroup: ['nonexistent'] } });

    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue({
      getUpdateGroupByName: jest.fn().mockResolvedValue(null),
    });

    const { req, res } = createMocks({ method: 'POST' });
    await uploadHandler(req, res);

    expect(res._getStatusCode()).toBe(400);
  });

  it('rejects unauthorized requests', async () => {
    arrange({ fields: { uploadKey: ['wrong-key'] } });

    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue({});

    const { req, res } = createMocks({ method: 'POST' });
    await uploadHandler(req, res);

    expect(res._getStatusCode()).toBe(401);
  });

  it('rejects requests with a session cookie but no UPLOAD_KEY', async () => {
    // Session cookies are intentionally not accepted here — uploads
    // require the shared UPLOAD_KEY regardless of dashboard login state.
    arrange({ fields: { uploadKey: undefined } });
    const createRelease = jest.fn();
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue({
      getDefaultUpdateGroup: jest.fn(),
      createRelease,
    });

    const { req, res } = createMocks({ method: 'POST', cookies: authedCookies() });
    await uploadHandler(req, res);

    expect(res._getStatusCode()).toBe(401);
    expect(createRelease).not.toHaveBeenCalled();
  });

  it('processes both ios and android when both are present in metadata.json', async () => {
    const { uploadFile } = arrange({
      metadata: {
        fileMetadata: {
          ios: { bundle: 'ios-bundle.js', assets: [{ path: 'ios-icon.png', ext: 'png' }] },
          android: {
            bundle: 'android-bundle.js',
            assets: [{ path: 'android-icon.png', ext: 'png' }],
          },
        },
      } as typeof METADATA_JSON,
    });
    const { createRelease } = mockDefaultGroupDatabase();

    const { req, res } = createMocks({ method: 'POST' });
    await uploadHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const paths = uploadFile.mock.calls.map((c) => c[0]);
    expect(paths.some((p) => p.endsWith('/ios/ios-bundle.js'))).toBe(true);
    expect(paths.some((p) => p.endsWith('/ios/ios-icon.png'))).toBe(true);
    expect(paths.some((p) => p.endsWith('/android/android-bundle.js'))).toBe(true);
    expect(paths.some((p) => p.endsWith('/android/android-icon.png'))).toBe(true);

    const manifestData = createRelease.mock.calls[0][0].manifestData;
    expect(manifestData.ios).toBeDefined();
    expect(manifestData.android).toBeDefined();
    expect(manifestData.ios.launchAsset.storageKey).toMatch(/\/ios\/ios-bundle\.js$/);
    expect(manifestData.android.launchAsset.storageKey).toMatch(/\/android\/android-bundle\.js$/);
  });

  it('uploads every asset when a platform has multiple', async () => {
    const { uploadFile } = arrange({
      metadata: {
        fileMetadata: {
          ios: {
            bundle: 'bundle.js',
            assets: [
              { path: 'a.png', ext: 'png' },
              { path: 'b.jpg', ext: 'jpg' },
              { path: 'c.json', ext: 'json' },
            ],
          },
        },
      } as typeof METADATA_JSON,
    });
    const { createRelease } = mockDefaultGroupDatabase();

    const { req, res } = createMocks({ method: 'POST' });
    await uploadHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    // 3 assets + 1 launch asset = 4 uploads.
    expect(uploadFile).toHaveBeenCalledTimes(4);

    const manifestData = createRelease.mock.calls[0][0].manifestData;
    expect(manifestData.ios.assets.map((a: { filePath: string }) => a.filePath).sort()).toEqual([
      'a.png',
      'b.jpg',
      'c.json',
    ]);
    const contentTypes = uploadFile.mock.calls.map((c) => c[2]?.contentType).sort();
    expect(contentTypes).toEqual([
      'application/javascript',
      'application/json',
      'image/jpeg',
      'image/png',
    ]);
  });

  it("defaults expoConfig to {} when the zip doesn't contain expoconfig.json", async () => {
    arrange({ hasExpoConfig: false });
    const { createRelease } = mockDefaultGroupDatabase();

    const { req, res } = createMocks({ method: 'POST' });
    await uploadHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const manifestData = createRelease.mock.calls[0][0].manifestData;
    expect(manifestData.ios.expoConfig).toEqual({});
  });

  it('uses the same id for the release row, the storage keys, and the response', async () => {
    const { uploadFile } = arrange();
    const { createRelease } = mockDefaultGroupDatabase();

    const { req, res } = createMocks({ method: 'POST' });
    await uploadHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const releaseRow = createRelease.mock.calls[0][0];
    const id: string = releaseRow.id;
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);

    // Every storage key is namespaced under the same release id.
    for (const [storagePath] of uploadFile.mock.calls) {
      expect(storagePath).toMatch(new RegExp(`^releases/${id}/`));
    }

    expect(releaseRow.path).toBe(`releases/${id}`);

    const body = JSON.parse(res._getData());
    expect(body.releaseId).toBe(id);
    expect(body.path).toBe(`releases/${id}`);
  });

  it('removes the uploaded zip from local disk on success', async () => {
    const { unlinkSync } = arrange();
    mockDefaultGroupDatabase();

    const { req, res } = createMocks({ method: 'POST' });
    await uploadHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(unlinkSync).toHaveBeenCalledWith('test.zip');
  });

  it('returns 500 when an asset upload fails', async () => {
    const { uploadFile } = arrange();
    uploadFile.mockRejectedValueOnce(new Error('R2 unavailable'));
    mockDefaultGroupDatabase();

    const { req, res } = createMocks({ method: 'POST' });
    await uploadHandler(req, res);

    expect(res._getStatusCode()).toBe(500);
  });
});
