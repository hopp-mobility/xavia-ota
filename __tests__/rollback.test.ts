import { createMocks } from 'node-mocks-http';

import { DatabaseFactory } from '../apiUtils/database/DatabaseFactory';
import { StorageFactory } from '../apiUtils/storage/StorageFactory';
import rollbackHandler from '../pages/api/rollback';

jest.mock('../apiUtils/database/DatabaseFactory');
jest.mock('../apiUtils/storage/StorageFactory');

describe('Rollback API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 405 for non-POST requests', async () => {
    const { req, res } = createMocks({ method: 'GET' });
    await rollbackHandler(req, res);
    expect(res._getStatusCode()).toBe(405);
    expect(JSON.parse(res._getData())).toMatchSnapshot();
  });

  it('should return 400 for missing required fields', async () => {
    const { req, res } = createMocks({
      method: 'POST',
      body: {},
    });
    await rollbackHandler(req, res);
    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toMatchSnapshot();
  });

  it('should handle rollback successfully', async () => {
    const mockStorage = {
      copyFile: jest.fn().mockResolvedValue(true),
    };

    const createRelease = jest.fn().mockResolvedValue(true);
    const mockDatabase = {
      createRelease,
      getReleaseByPath: jest.fn().mockResolvedValue({
        id: 'r1',
        path: 'updates/1.0.0/old.zip',
        runtimeVersion: '1.0.0',
        timestamp: 't',
        commitHash: 'abc123',
        commitMessage: '',
        updateGroupId: 'g-default',
      }),
      getUpdateGroupByName: jest.fn(),
      getDefaultUpdateGroup: jest.fn(),
    };

    (StorageFactory.getStorage as jest.Mock).mockReturnValue(mockStorage);
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(mockDatabase);

    Date.now = jest.fn(() => new Date('2020-05-13T12:33:37.000Z').getTime());

    const { req, res } = createMocks({
      method: 'POST',
      body: {
        path: 'updates/1.0.0/old.zip',
        runtimeVersion: '1.0.0',
        commitHash: 'abc123',
      },
    });

    await rollbackHandler(req, res);
    expect(res._getStatusCode()).toBe(200);
    expect(res._getData()).toMatchSnapshot();
    expect(mockStorage.copyFile).toHaveBeenCalled();
    expect(createRelease).toHaveBeenCalledWith(expect.objectContaining({ updateGroupId: 'g-default' }));
  });

  it('inherits the source release group when no override is provided', async () => {
    const mockStorage = { copyFile: jest.fn().mockResolvedValue(undefined) };
    const createRelease = jest.fn().mockResolvedValue({});
    const mockDatabase = {
      getReleaseByPath: jest.fn().mockResolvedValue({
        id: 'r1',
        path: 'updates/1.0.0/old.zip',
        runtimeVersion: '1.0.0',
        timestamp: 't',
        commitHash: 'h',
        commitMessage: 'm',
        updateGroupId: 'g-beta',
      }),
      getUpdateGroupByName: jest.fn(),
      getDefaultUpdateGroup: jest.fn(),
      createRelease,
    };
    (StorageFactory.getStorage as jest.Mock).mockReturnValue(mockStorage);
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(mockDatabase);

    const { req, res } = createMocks({
      method: 'POST',
      body: {
        path: 'updates/1.0.0/old.zip',
        runtimeVersion: '1.0.0',
        commitHash: 'h',
        commitMessage: 'm',
      },
    });
    await rollbackHandler(req, res);

    expect(createRelease).toHaveBeenCalledWith(expect.objectContaining({ updateGroupId: 'g-beta' }));
  });

  it('honors the updateGroup override', async () => {
    const mockStorage = { copyFile: jest.fn().mockResolvedValue(undefined) };
    const createRelease = jest.fn().mockResolvedValue({});
    const mockDatabase = {
      getReleaseByPath: jest.fn().mockResolvedValue({
        id: 'r1',
        path: 'updates/1.0.0/old.zip',
        runtimeVersion: '1.0.0',
        timestamp: 't',
        commitHash: 'h',
        commitMessage: 'm',
        updateGroupId: 'g-prod',
      }),
      getUpdateGroupByName: jest.fn().mockResolvedValue({
        id: 'g-beta', name: 'beta', isDefault: false, createdAt: 't',
      }),
      createRelease,
    };
    (StorageFactory.getStorage as jest.Mock).mockReturnValue(mockStorage);
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(mockDatabase);

    const { req, res } = createMocks({
      method: 'POST',
      body: {
        path: 'updates/1.0.0/old.zip',
        runtimeVersion: '1.0.0',
        commitHash: 'h',
        commitMessage: 'm',
        updateGroup: 'beta',
      },
    });
    await rollbackHandler(req, res);

    expect(mockDatabase.getUpdateGroupByName).toHaveBeenCalledWith('beta');
    expect(createRelease).toHaveBeenCalledWith(expect.objectContaining({ updateGroupId: 'g-beta' }));
  });
});
