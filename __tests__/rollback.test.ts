import { createMocks } from 'node-mocks-http';

import { DatabaseFactory } from '../apiUtils/database/DatabaseFactory';
import { ManifestData, Release } from '../apiUtils/database/DatabaseInterface';
import rollbackHandler from '../pages/api/rollback';
import { authedCookies } from './helpers/session';

jest.mock('../apiUtils/database/DatabaseFactory');

const SOURCE_MANIFEST_DATA: ManifestData = {
  ios: {
    expoConfig: { name: 'app' },
    launchAsset: {
      filePath: 'bundle.js',
      storageKey: 'releases/src-id/ios/bundle.js',
      hash: 'h',
      key: 'k',
      fileExtension: '.bundle',
      contentType: 'application/javascript',
    },
    assets: [],
  },
};

const sourceRelease: Release = {
  id: 'src-id',
  path: 'releases/src-id',
  runtimeVersion: '1.0.0',
  timestamp: 't',
  commitHash: 'old-hash',
  commitMessage: 'old',
  updateId: 'old-update-id',
  updateGroupId: 'g-prod',
  manifestData: SOURCE_MANIFEST_DATA,
};

describe('Rollback API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 405 for non-POST requests', async () => {
    const { req, res } = createMocks({ method: 'GET' });
    await rollbackHandler(req, res);
    expect(res._getStatusCode()).toBe(405);
  });

  it('returns 400 for missing required fields', async () => {
    const { req, res } = createMocks({
      method: 'POST',
      body: {},
      cookies: authedCookies(),
    });
    await rollbackHandler(req, res);
    expect(res._getStatusCode()).toBe(400);
  });

  it('returns 404 when the source release does not exist', async () => {
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue({
      getReleaseByPath: jest.fn().mockResolvedValue(null),
    });

    const { req, res } = createMocks({
      method: 'POST',
      body: {
        path: 'releases/missing',
        runtimeVersion: '1.0.0',
        commitHash: 'h',
      },
      cookies: authedCookies(),
    });
    await rollbackHandler(req, res);
    expect(res._getStatusCode()).toBe(404);
  });

  it('creates a new release that copies the source manifest_data with no file copies', async () => {
    const createRelease = jest.fn().mockResolvedValue({});
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue({
      getReleaseByPath: jest.fn().mockResolvedValue(sourceRelease),
      getUpdateGroupByName: jest.fn(),
      createRelease,
    });

    const { req, res } = createMocks({
      method: 'POST',
      body: {
        path: 'releases/src-id',
        runtimeVersion: '1.0.0',
        commitHash: 'new-hash',
        commitMessage: 'rollback',
      },
      cookies: authedCookies(),
    });
    await rollbackHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(createRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringMatching(/^releases\//),
        manifestData: SOURCE_MANIFEST_DATA,
        updateGroupId: 'g-prod',
        commitHash: 'new-hash',
        commitMessage: 'rollback',
      })
    );
  });

  it('issues a fresh updateId instead of reusing the source release id', async () => {
    const createRelease = jest.fn().mockResolvedValue({});
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue({
      getReleaseByPath: jest.fn().mockResolvedValue(sourceRelease),
      getUpdateGroupByName: jest.fn(),
      createRelease,
    });

    const { req, res } = createMocks({
      method: 'POST',
      body: {
        path: 'releases/src-id',
        runtimeVersion: '1.0.0',
        commitHash: 'new-hash',
        commitMessage: 'rollback',
      },
      cookies: authedCookies(),
    });
    await rollbackHandler(req, res);

    const persisted = createRelease.mock.calls[0][0];
    expect(persisted.updateId).not.toBe('old-update-id');
    expect(persisted.updateId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('honors the updateGroup override', async () => {
    const createRelease = jest.fn().mockResolvedValue({});
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue({
      getReleaseByPath: jest.fn().mockResolvedValue(sourceRelease),
      getUpdateGroupByName: jest
        .fn()
        .mockResolvedValue({ id: 'g-beta', name: 'beta', isDefault: false, createdAt: 't' }),
      createRelease,
    });

    const { req, res } = createMocks({
      method: 'POST',
      body: {
        path: 'releases/src-id',
        runtimeVersion: '1.0.0',
        commitHash: 'h',
        commitMessage: 'm',
        updateGroup: 'beta',
      },
      cookies: authedCookies(),
    });
    await rollbackHandler(req, res);

    expect(createRelease).toHaveBeenCalledWith(
      expect.objectContaining({ updateGroupId: 'g-beta' })
    );
  });

  it('returns 400 when the override group is unknown', async () => {
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue({
      getReleaseByPath: jest.fn().mockResolvedValue(sourceRelease),
      getUpdateGroupByName: jest.fn().mockResolvedValue(null),
    });

    const { req, res } = createMocks({
      method: 'POST',
      body: {
        path: 'releases/src-id',
        runtimeVersion: '1.0.0',
        commitHash: 'h',
        commitMessage: 'm',
        updateGroup: 'missing',
      },
      cookies: authedCookies(),
    });
    await rollbackHandler(req, res);

    expect(res._getStatusCode()).toBe(400);
  });
});
