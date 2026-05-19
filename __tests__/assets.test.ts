import { createMocks } from 'node-mocks-http';

import { DatabaseFactory } from '../apiUtils/database/DatabaseFactory';
import { DatabaseInterface, Release } from '../apiUtils/database/DatabaseInterface';
import { UpdateHelper } from '../apiUtils/helpers/UpdateHelper';
import { ZipHelper } from '../apiUtils/helpers/ZipHelper';
import assetsEndpoint from '../pages/api/assets';

jest.mock('../apiUtils/helpers/UpdateHelper');
jest.mock('../apiUtils/helpers/ZipHelper');
jest.mock('../apiUtils/database/DatabaseFactory');

const baseRelease: Release = {
  id: 'release-id-42',
  runtimeVersion: '1.0.0',
  path: 'updates/1.0.0/12345.zip',
  timestamp: '2024-03-20T00:00:00Z',
  commitHash: 'abc',
  commitMessage: 'msg',
  updateId: 'uid-1',
  updateGroupId: 'g-prod',
};

describe('Assets API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when asset path is missing', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      query: { platform: 'ios', runtimeVersion: '1.0.0', releaseId: 'release-id-42' },
    });
    await assetsEndpoint(req, res);
    expect(res._getStatusCode()).toBe(400);
  });

  it('returns 400 when platform is invalid', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      query: {
        asset: 'test.png',
        platform: 'web',
        runtimeVersion: '1.0.0',
        releaseId: 'release-id-42',
      },
    });
    await assetsEndpoint(req, res);
    expect(res._getStatusCode()).toBe(400);
  });

  it('returns 400 when releaseId is missing (e.g. stale pre-deploy manifest)', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      query: {
        asset: 'test.png',
        platform: 'ios',
        runtimeVersion: '1.0.0',
      },
    });
    await assetsEndpoint(req, res);
    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: 'No releaseId provided.' });
  });

  it('returns 404 when releaseId does not match any release', async () => {
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue({
      getRelease: jest.fn().mockResolvedValue(null),
    } as unknown as DatabaseInterface);

    const { req, res } = createMocks({
      method: 'GET',
      query: {
        asset: 'test.png',
        platform: 'ios',
        runtimeVersion: '1.0.0',
        releaseId: 'unknown',
      },
    });
    await assetsEndpoint(req, res);
    expect(res._getStatusCode()).toBe(404);
  });

  it("returns 400 when the release's runtimeVersion does not match the query", async () => {
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue({
      getRelease: jest.fn().mockResolvedValue({ ...baseRelease, runtimeVersion: '2.0.0' }),
    } as unknown as DatabaseInterface);

    const { req, res } = createMocks({
      method: 'GET',
      query: {
        asset: 'test.png',
        platform: 'ios',
        runtimeVersion: '1.0.0',
        releaseId: 'release-id-42',
      },
    });
    await assetsEndpoint(req, res);
    expect(res._getStatusCode()).toBe(400);
  });

  it('serves the asset from the resolved release bundle', async () => {
    const getRelease = jest.fn().mockResolvedValue(baseRelease);
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue({
      getRelease,
    } as unknown as DatabaseInterface);

    (UpdateHelper.getMetadataAsync as jest.Mock).mockResolvedValue({
      metadataJson: {
        fileMetadata: {
          ios: {
            assets: [{ path: 'test.png', ext: '.png' }],
            bundle: 'bundle.js',
          },
        },
      },
    });
    (ZipHelper.getZipFromStorage as jest.Mock).mockResolvedValue({});
    (ZipHelper.getFileFromZip as jest.Mock).mockResolvedValue(Buffer.from('test'));

    const { req, res } = createMocks({
      method: 'GET',
      query: {
        asset: 'test.png',
        platform: 'ios',
        runtimeVersion: '1.0.0',
        releaseId: 'release-id-42',
      },
    });
    await assetsEndpoint(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(getRelease).toHaveBeenCalledWith('release-id-42');
    // Path is the zip path with the `.zip` suffix stripped — same shape the
    // manifest endpoint feeds to the storage layer.
    expect(UpdateHelper.getMetadataAsync).toHaveBeenCalledWith(
      expect.objectContaining({ updateBundlePath: 'updates/1.0.0/12345' })
    );
  });
});
