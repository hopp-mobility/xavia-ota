import { createMocks } from 'node-mocks-http';

import { DatabaseFactory } from '../apiUtils/database/DatabaseFactory';
import releasesHandler from '../pages/api/releases';
import { authedCookies } from './helpers/session';

jest.mock('../apiUtils/database/DatabaseFactory');

describe('Releases API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 405 for non-GET requests', async () => {
    const { req, res } = createMocks({ method: 'POST' });
    await releasesHandler(req, res);
    expect(res._getStatusCode()).toBe(405);
  });

  it('returns 401 without a valid session cookie', async () => {
    const { req, res } = createMocks({ method: 'GET' });
    await releasesHandler(req, res);
    expect(res._getStatusCode()).toBe(401);
  });

  it('returns releases from the database', async () => {
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue({
      listReleases: jest.fn().mockResolvedValue([
        {
          id: 'r1',
          path: 'releases/r1',
          runtimeVersion: '1.0.0',
          timestamp: '2024-03-20T00:00:00Z',
          commitHash: 'abc123',
          commitMessage: 'first',
          updateId: 'update-1',
          updateGroupId: 'g-beta',
          updateGroupName: 'beta',
        },
      ]),
    });

    const { req, res } = createMocks({ method: 'GET', cookies: authedCookies() });
    await releasesHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const { releases } = JSON.parse(res._getData());
    expect(releases).toEqual([
      {
        path: 'releases/r1',
        runtimeVersion: '1.0.0',
        timestamp: '2024-03-20T00:00:00Z',
        commitHash: 'abc123',
        commitMessage: 'first',
        updateId: 'update-1',
        updateGroupId: 'g-beta',
        updateGroupName: 'beta',
      },
    ]);
  });

  it('returns 500 when the DB call fails', async () => {
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue({
      listReleases: jest.fn().mockRejectedValue(new Error('boom')),
    });

    const { req, res } = createMocks({ method: 'GET', cookies: authedCookies() });
    await releasesHandler(req, res);

    expect(res._getStatusCode()).toBe(500);
  });
});
