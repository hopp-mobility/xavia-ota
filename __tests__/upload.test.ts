import AdmZip from 'adm-zip';
import formidable from 'formidable';
import fs from 'fs';
import { createMocks } from 'node-mocks-http';

import { DatabaseFactory } from '../apiUtils/database/DatabaseFactory';
import { StorageFactory } from '../apiUtils/storage/StorageFactory';
import { ZipHelper } from '../apiUtils/helpers/ZipHelper';
import { HashHelper } from '../apiUtils/helpers/HashHelper';
import uploadHandler from '../pages/api/upload';

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
}: {
  fields?: Record<string, string[] | undefined>;
  hasFile?: boolean;
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
      if (filePath === 'metadata.json') return Buffer.from(JSON.stringify(METADATA_JSON));
      if (filePath === 'expoconfig.json') return Buffer.from(JSON.stringify({ name: 'app' }));
      return Buffer.from(`${filePath}-bytes`);
    }
  );

  (HashHelper.createHash as jest.Mock).mockReturnValue('hash');
  (HashHelper.getBase64URLEncoding as jest.Mock).mockReturnValue('hashb64');
  (HashHelper.convertSHA256HashToUUID as jest.Mock).mockReturnValue('update-id-uuid');

  const uploadFile = jest.fn().mockImplementation((path: string) => Promise.resolve(path));
  (StorageFactory.getStorage as jest.Mock).mockReturnValue({ uploadFile });

  jest.spyOn(fs, 'unlinkSync').mockImplementation(() => undefined);

  return { uploadFile };
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
});
