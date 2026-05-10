import { createMocks } from 'node-mocks-http';

import { DatabaseFactory } from '../apiUtils/database/DatabaseFactory';
import membersHandler from '../pages/api/update-groups/[id]/members';

jest.mock('../apiUtils/database/DatabaseFactory');

describe('Update group members API', () => {
  beforeEach(() => jest.clearAllMocks());

  it('GET lists members', async () => {
    const members = [{ updateGroupId: 'g1', userId: 'u1', createdAt: 't' }];
    const db = {
      getUpdateGroup: jest.fn().mockResolvedValue({ id: 'g1', name: 'beta', isDefault: false, createdAt: 't' }),
      listGroupMembers: jest.fn().mockResolvedValue(members),
    };
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(db);

    const { req, res } = createMocks({ method: 'GET', query: { id: 'g1' } });
    await membersHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({ members });
  });

  it('POST adds a member', async () => {
    const db = {
      getUpdateGroup: jest.fn().mockResolvedValue({ id: 'g1', name: 'beta', isDefault: false, createdAt: 't' }),
      addUserToGroup: jest.fn().mockResolvedValue(undefined),
    };
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(db);

    const { req, res } = createMocks({
      method: 'POST',
      query: { id: 'g1' },
      body: { userId: 'u42' },
    });
    await membersHandler(req, res);

    expect(db.addUserToGroup).toHaveBeenCalledWith('g1', 'u42', undefined);
    expect(res._getStatusCode()).toBe(204);
  });

  it('POST passes label through', async () => {
    const db = {
      getUpdateGroup: jest.fn().mockResolvedValue({ id: 'g1', name: 'beta', isDefault: false, createdAt: 't' }),
      addUserToGroup: jest.fn().mockResolvedValue(undefined),
    };
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(db);

    const { req, res } = createMocks({
      method: 'POST',
      query: { id: 'g1' },
      body: { userId: 'u42', label: 'hannes@hopp.bike' },
    });
    await membersHandler(req, res);

    expect(db.addUserToGroup).toHaveBeenCalledWith('g1', 'u42', 'hannes@hopp.bike');
    expect(res._getStatusCode()).toBe(204);
  });

  it('POST rejects missing userId', async () => {
    const db = {
      getUpdateGroup: jest.fn().mockResolvedValue({ id: 'g1', name: 'beta', isDefault: false, createdAt: 't' }),
    };
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(db);
    const { req, res } = createMocks({ method: 'POST', query: { id: 'g1' }, body: {} });
    await membersHandler(req, res);
    expect(res._getStatusCode()).toBe(400);
  });

  it('POST rejects when group is the default', async () => {
    const db = {
      getUpdateGroup: jest.fn().mockResolvedValue({ id: 'g1', name: 'production', isDefault: true, createdAt: 't' }),
    };
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(db);
    const { req, res } = createMocks({ method: 'POST', query: { id: 'g1' }, body: { userId: 'u1' } });
    await membersHandler(req, res);
    expect(res._getStatusCode()).toBe(400);
  });

  it('DELETE removes a member', async () => {
    const db = {
      getUpdateGroup: jest.fn().mockResolvedValue({ id: 'g1', name: 'beta', isDefault: false, createdAt: 't' }),
      removeUserFromGroup: jest.fn().mockResolvedValue(undefined),
    };
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(db);

    const { req, res } = createMocks({
      method: 'DELETE',
      query: { id: 'g1', userId: 'u42' },
    });
    await membersHandler(req, res);

    expect(db.removeUserFromGroup).toHaveBeenCalledWith('g1', 'u42');
    expect(res._getStatusCode()).toBe(204);
  });

  it('returns 404 if group not found', async () => {
    const db = { getUpdateGroup: jest.fn().mockResolvedValue(null) };
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(db);
    const { req, res } = createMocks({ method: 'GET', query: { id: 'nope' } });
    await membersHandler(req, res);
    expect(res._getStatusCode()).toBe(404);
  });
});
