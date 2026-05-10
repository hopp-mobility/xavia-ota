import { createMocks } from 'node-mocks-http';

import { DatabaseFactory } from '../apiUtils/database/DatabaseFactory';
import { StorageFactory } from '../apiUtils/storage/StorageFactory';
import releasesHandler from '../pages/api/releases';

jest.mock('../apiUtils/database/DatabaseFactory');
jest.mock('../apiUtils/storage/StorageFactory');

describe('Releases API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 405 for non-GET requests', async () => {
    const { req, res } = createMocks({ method: 'POST' });
    await releasesHandler(req, res);
    expect(res._getStatusCode()).toBe(405);
    expect(JSON.parse(res._getData())).toMatchSnapshot();
  });

  it('should return releases successfully', async () => {
    const mockStorage = {
      listDirectories: jest.fn().mockResolvedValue(['1.0.0']),
      listFiles: jest.fn().mockResolvedValue([
        {
          name: 'update.zip',
          created_at: '2024-03-20T00:00:00Z',
          metadata: { size: 1000 },
        },
      ]),
    };

    const mockDatabase = {
      listReleases: jest.fn().mockResolvedValue([
        {
          path: 'updates/1.0.0/update.zip',
          commitHash: 'abc123',
        },
      ]),
    };

    (StorageFactory.getStorage as jest.Mock).mockReturnValue(mockStorage);
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(mockDatabase);

    const { req, res } = createMocks({ method: 'GET' });
    await releasesHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toMatchSnapshot();
  });

  it('should handle errors gracefully', async () => {
    const mockStorage = {
      listDirectories: jest.fn().mockRejectedValue(new Error('Storage error')),
    };

    (StorageFactory.getStorage as jest.Mock).mockReturnValue(mockStorage);

    const { req, res } = createMocks({ method: 'GET' });
    await releasesHandler(req, res);

    expect(res._getStatusCode()).toBe(500);
    expect(JSON.parse(res._getData())).toMatchSnapshot();
  });

  it('includes update group fields on each release', async () => {
    const mockStorage = {
      listDirectories: jest.fn().mockResolvedValue(['1.0.0']),
      listFiles: jest.fn().mockResolvedValue([
        { name: 'a.zip', created_at: 't', metadata: { size: 1 } },
      ]),
    };
    const mockDatabase = {
      listReleases: jest.fn().mockResolvedValue([
        {
          id: 'r1',
          path: 'updates/1.0.0/a.zip',
          runtimeVersion: '1.0.0',
          timestamp: 't',
          commitHash: 'h',
          commitMessage: 'm',
          updateGroupId: 'g-beta',
          updateGroupName: 'beta',
        },
      ]),
    };
    (StorageFactory.getStorage as jest.Mock).mockReturnValue(mockStorage);
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(mockDatabase);

    const { req, res } = createMocks({ method: 'GET' });
    await releasesHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const { releases } = JSON.parse(res._getData());
    expect(releases[0]).toEqual(expect.objectContaining({
      updateGroupId: 'g-beta',
      updateGroupName: 'beta',
    }));
  });
});
