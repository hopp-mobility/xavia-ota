import { createMocks } from 'node-mocks-http';

import { DatabaseFactory } from '../apiUtils/database/DatabaseFactory';
import indexHandler from '../pages/api/update-groups/index';
import idHandler from '../pages/api/update-groups/[id]';
import { authedCookies } from './helpers/session';

jest.mock('../apiUtils/database/DatabaseFactory');

describe('Update groups API', () => {
  beforeEach(() => jest.clearAllMocks());

  it('GET /api/update-groups returns the list', async () => {
    const groups = [
      { id: 'g1', name: 'production', isDefault: true, createdAt: 't' },
      { id: 'g2', name: 'beta', isDefault: false, createdAt: 't' },
    ];
    const db = { listUpdateGroups: jest.fn().mockResolvedValue(groups) };
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(db);

    const { req, res } = createMocks({ method: 'GET', cookies: authedCookies() });
    await indexHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({ groups });
  });

  it('POST /api/update-groups creates a group', async () => {
    const created = { id: 'g3', name: 'alpha', isDefault: false, createdAt: 't' };
    const db = { createUpdateGroup: jest.fn().mockResolvedValue(created) };
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(db);

    const { req, res } = createMocks({
      method: 'POST',
      body: { name: 'alpha' },
      cookies: authedCookies(),
    });
    await indexHandler(req, res);

    expect(db.createUpdateGroup).toHaveBeenCalledWith('alpha');
    expect(res._getStatusCode()).toBe(201);
    expect(JSON.parse(res._getData())).toEqual({ group: created });
  });

  it('POST /api/update-groups rejects missing name', async () => {
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue({});
    const { req, res } = createMocks({ method: 'POST', body: {}, cookies: authedCookies() });
    await indexHandler(req, res);
    expect(res._getStatusCode()).toBe(400);
  });

  it('DELETE /api/update-groups/:id refuses if group is default', async () => {
    const db = {
      getUpdateGroup: jest.fn().mockResolvedValue({
        id: 'g1', name: 'production', isDefault: true, createdAt: 't',
      }),
      deleteUpdateGroup: jest.fn(),
    };
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(db);

    const { req, res } = createMocks({ method: 'DELETE', query: { id: 'g1' }, cookies: authedCookies() });
    await idHandler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(db.deleteUpdateGroup).not.toHaveBeenCalled();
  });

  it('DELETE /api/update-groups/:id deletes a non-default group', async () => {
    const db = {
      getUpdateGroup: jest.fn().mockResolvedValue({
        id: 'g2', name: 'beta', isDefault: false, createdAt: 't',
      }),
      deleteUpdateGroup: jest.fn().mockResolvedValue(undefined),
    };
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(db);

    const { req, res } = createMocks({ method: 'DELETE', query: { id: 'g2' }, cookies: authedCookies() });
    await idHandler(req, res);

    expect(db.deleteUpdateGroup).toHaveBeenCalledWith('g2');
    expect(res._getStatusCode()).toBe(204);
  });

  it('returns 401 without a valid session cookie', async () => {
    const { req, res } = createMocks({ method: 'GET' });
    await indexHandler(req, res);
    expect(res._getStatusCode()).toBe(401);
  });
});
