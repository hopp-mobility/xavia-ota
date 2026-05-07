# Update Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single global release distribution model with per-group releases. Beta and per-user diagnostic builds become possible. Resolver: non-default groups always win over the default; default acts as fallback.

**Architecture:** Two new tables (`update_groups`, `update_group_members`) plus a new FK on `releases`. The manifest endpoint reads a `xavia-user-id` header and runs a two-step resolver: (1) newest release in the user's non-default groups, (2) fallback to newest release in the default group. Upload/rollback accept an optional group **name** and resolve to id server-side. Dashboard gets a groups admin page and a group selector in the upload form.

**Tech Stack:** Next.js Pages Router, TypeScript, `pg` (Postgres) + Supabase JS, Chakra UI v2, Jest with `node-mocks-http`.

**Spec:** `docs/superpowers/specs/2026-05-06-update-groups-design.md`

---

## File Structure

**New files:**
- `containers/database/schema/update_groups.sql` — schema migration for postgres dev/local
- `pages/api/update-groups/index.ts` — `GET` list groups, `POST` create group
- `pages/api/update-groups/[id].ts` — `DELETE` a group
- `pages/api/update-groups/[id]/members.ts` — `GET` list members, `POST` add member, `DELETE` remove member
- `pages/update-groups.tsx` — dashboard groups admin page
- `__tests__/updateGroups.test.ts` — tests for the groups CRUD endpoints
- `__tests__/updateGroupMembers.test.ts` — tests for the members endpoints

**Modified files:**
- `apiUtils/database/DatabaseFactory.ts` — add table enum entries
- `apiUtils/database/DatabaseInterface.ts` — add `UpdateGroup` interface and method signatures, extend `Release`
- `apiUtils/database/LocalDatabase.ts` — implement new methods
- `apiUtils/database/SupabaseDatabase.ts` — implement new methods
- `pages/api/manifest.ts` — read `xavia-user-id`, call new resolver
- `pages/api/upload.ts` — accept `updateGroup` form field (name); look up id; use it
- `pages/api/rollback.ts` — accept `updateGroup` (name); default to source release's group
- `pages/api/releases.ts` — return group name per release
- `pages/releases.tsx` — show group badge + filter; group selector in upload form
- `__tests__/manifest.test.ts` — extend with group-aware cases
- `__tests__/upload.test.ts` — extend with group field cases
- `__tests__/rollback.test.ts` — extend with group inheritance cases
- `__tests__/releases.test.ts` — extend with group name in response

---

## Task 1: Schema migration

**Files:**
- Create: `containers/database/schema/update_groups.sql`

The existing schema files are mounted into postgres via `containers/database/docker-compose.yml` and run alphabetically on first boot (`releases.sql` → `tracking.sql` → `update_groups.sql`). For Supabase deployments, the operator applies the same SQL through the Supabase SQL editor.

- [ ] **Step 1: Write the migration SQL**

Create `containers/database/schema/update_groups.sql`:

```sql
CREATE TABLE IF NOT EXISTS update_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE,
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS one_default_update_group
    ON update_groups ((is_default))
    WHERE is_default = true;

CREATE TABLE IF NOT EXISTS update_group_members (
    update_group_id UUID NOT NULL REFERENCES update_groups(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (update_group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_update_group_members_user_id
    ON update_group_members(user_id);

INSERT INTO update_groups (name, is_default)
VALUES ('production', true)
ON CONFLICT (name) DO NOTHING;

ALTER TABLE releases
    ADD COLUMN IF NOT EXISTS update_group_id UUID REFERENCES update_groups(id);

UPDATE releases
SET update_group_id = (SELECT id FROM update_groups WHERE is_default = true)
WHERE update_group_id IS NULL;

ALTER TABLE releases
    ALTER COLUMN update_group_id SET NOT NULL;
```

- [ ] **Step 2: Verify against the docker-compose dev DB**

```bash
docker-compose -f containers/database/docker-compose.yml down -v
docker-compose -f containers/database/docker-compose.yml up -d
docker exec xavia-postgres psql -U postgres -d releases_db -c "\d update_groups"
docker exec xavia-postgres psql -U postgres -d releases_db -c "\d update_group_members"
docker exec xavia-postgres psql -U postgres -d releases_db -c "SELECT * FROM update_groups;"
docker exec xavia-postgres psql -U postgres -d releases_db -c "\d releases"
```

Expected: tables exist, one row in `update_groups` with `is_default=true name=production`, `releases.update_group_id` is `NOT NULL`.

- [ ] **Step 3: Commit**

```bash
git add containers/database/schema/update_groups.sql
git commit -m "feat(db): add update_groups and update_group_members tables"
```

---

## Task 2: TypeScript interfaces

**Files:**
- Modify: `apiUtils/database/DatabaseInterface.ts`
- Modify: `apiUtils/database/DatabaseFactory.ts`

- [ ] **Step 1: Extend `Tables` enum**

Edit `apiUtils/database/DatabaseFactory.ts`. Replace the `Tables` enum:

```typescript
export enum Tables {
  RELEASES = 'releases',
  RELEASES_TRACKING = 'releases_tracking',
  UPDATE_GROUPS = 'update_groups',
  UPDATE_GROUP_MEMBERS = 'update_group_members',
}
```

- [ ] **Step 2: Add `UpdateGroup` interface and extend `Release`**

Edit `apiUtils/database/DatabaseInterface.ts`. Replace the file with:

```typescript
export interface Release {
  id: string;
  runtimeVersion: string;
  path: string;
  timestamp: string;
  commitHash: string;
  commitMessage: string;
  updateId?: string;
  updateGroupId: string;
  updateGroupName?: string;
}

export interface Tracking {
  id: string;
  releaseId: string;
  downloadTimestamp: string;
  platform: string;
}

export interface TrackingMetrics {
  platform: string;
  count: number;
}

export interface UpdateGroup {
  id: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
}

export interface UpdateGroupMember {
  updateGroupId: string;
  userId: string;
  createdAt: string;
}

export interface DatabaseInterface {
  createRelease(release: Omit<Release, 'id' | 'updateGroupName'>): Promise<Release>;
  getRelease(id: string): Promise<Release | null>;
  getReleaseByPath(path: string): Promise<Release | null>;
  listReleases(): Promise<Release[]>;
  createTracking(tracking: Omit<Tracking, 'id'>): Promise<Tracking>;
  getReleaseTrackingMetrics(releaseId: string): Promise<TrackingMetrics[]>;
  getReleaseTrackingMetricsForAllReleases(): Promise<TrackingMetrics[]>;
  getLatestReleaseRecordForRuntimeVersion(runtimeVersion: string): Promise<Release | null>;

  // Update groups
  listUpdateGroups(): Promise<UpdateGroup[]>;
  getUpdateGroup(id: string): Promise<UpdateGroup | null>;
  getUpdateGroupByName(name: string): Promise<UpdateGroup | null>;
  getDefaultUpdateGroup(): Promise<UpdateGroup>;
  createUpdateGroup(name: string): Promise<UpdateGroup>;
  deleteUpdateGroup(id: string): Promise<void>;

  // Membership
  listGroupMembers(updateGroupId: string): Promise<UpdateGroupMember[]>;
  addUserToGroup(updateGroupId: string, userId: string): Promise<void>;
  removeUserFromGroup(updateGroupId: string, userId: string): Promise<void>;

  // Resolver
  getLatestReleaseForUser(
    runtimeVersion: string,
    userId: string | null
  ): Promise<Release | null>;
}
```

- [ ] **Step 3: Verify the codebase still type-checks against the new interface (it won't yet)**

```bash
npx tsc --noEmit
```

Expected: errors in `LocalDatabase.ts` and `SupabaseDatabase.ts` for the missing methods. That's the failing-test analogue here — the next task implements them.

- [ ] **Step 4: Commit**

```bash
git add apiUtils/database/DatabaseInterface.ts apiUtils/database/DatabaseFactory.ts
git commit -m "feat(db): add UpdateGroup types and DatabaseInterface methods"
```

---

## Task 3: Postgres implementation — group CRUD

**Files:**
- Modify: `apiUtils/database/LocalDatabase.ts`

- [ ] **Step 1: Add group CRUD methods to `PostgresDatabase`**

Append these methods inside the `PostgresDatabase` class (just before the closing `}`):

```typescript
  async listUpdateGroups(): Promise<UpdateGroup[]> {
    const { rows } = await this.pool.query(`
      SELECT id, name, is_default as "isDefault", created_at as "createdAt"
      FROM ${Tables.UPDATE_GROUPS}
      ORDER BY is_default DESC, name ASC
    `);
    return rows;
  }

  async getUpdateGroup(id: string): Promise<UpdateGroup | null> {
    const { rows } = await this.pool.query(
      `SELECT id, name, is_default as "isDefault", created_at as "createdAt"
       FROM ${Tables.UPDATE_GROUPS} WHERE id = $1`,
      [id]
    );
    return rows[0] || null;
  }

  async getUpdateGroupByName(name: string): Promise<UpdateGroup | null> {
    const { rows } = await this.pool.query(
      `SELECT id, name, is_default as "isDefault", created_at as "createdAt"
       FROM ${Tables.UPDATE_GROUPS} WHERE name = $1`,
      [name]
    );
    return rows[0] || null;
  }

  async getDefaultUpdateGroup(): Promise<UpdateGroup> {
    const { rows } = await this.pool.query(
      `SELECT id, name, is_default as "isDefault", created_at as "createdAt"
       FROM ${Tables.UPDATE_GROUPS} WHERE is_default = true LIMIT 1`
    );
    if (!rows[0]) throw new Error('No default update group configured');
    return rows[0];
  }

  async createUpdateGroup(name: string): Promise<UpdateGroup> {
    const { rows } = await this.pool.query(
      `INSERT INTO ${Tables.UPDATE_GROUPS} (name)
       VALUES ($1)
       RETURNING id, name, is_default as "isDefault", created_at as "createdAt"`,
      [name]
    );
    return rows[0];
  }

  async deleteUpdateGroup(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM ${Tables.UPDATE_GROUPS} WHERE id = $1`, [id]);
  }
```

Update the imports at the top of the file:

```typescript
import {
  DatabaseInterface,
  Release,
  Tracking,
  TrackingMetrics,
  UpdateGroup,
  UpdateGroupMember,
} from './DatabaseInterface';
```

- [ ] **Step 2: Add membership methods**

Continue inside `PostgresDatabase`:

```typescript
  async listGroupMembers(updateGroupId: string): Promise<UpdateGroupMember[]> {
    const { rows } = await this.pool.query(
      `SELECT update_group_id as "updateGroupId", user_id as "userId", created_at as "createdAt"
       FROM ${Tables.UPDATE_GROUP_MEMBERS} WHERE update_group_id = $1
       ORDER BY created_at DESC`,
      [updateGroupId]
    );
    return rows;
  }

  async addUserToGroup(updateGroupId: string, userId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${Tables.UPDATE_GROUP_MEMBERS} (update_group_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [updateGroupId, userId]
    );
  }

  async removeUserFromGroup(updateGroupId: string, userId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM ${Tables.UPDATE_GROUP_MEMBERS}
       WHERE update_group_id = $1 AND user_id = $2`,
      [updateGroupId, userId]
    );
  }
```

- [ ] **Step 3: Add the resolver**

Continue inside `PostgresDatabase`:

```typescript
  async getLatestReleaseForUser(
    runtimeVersion: string,
    userId: string | null
  ): Promise<Release | null> {
    const baseSelect = `
      SELECT r.id, r.runtime_version as "runtimeVersion", r.path, r.timestamp,
             r.commit_hash as "commitHash", r.commit_message as "commitMessage",
             r.update_id as "updateId", r.update_group_id as "updateGroupId"
      FROM ${Tables.RELEASES} r
    `;

    if (userId) {
      const groupQuery = `
        ${baseSelect}
        WHERE r.runtime_version = $1
          AND r.update_group_id IN (
            SELECT update_group_id FROM ${Tables.UPDATE_GROUP_MEMBERS} WHERE user_id = $2
          )
        ORDER BY r.timestamp DESC
        LIMIT 1
      `;
      const groupResult = await this.pool.query(groupQuery, [runtimeVersion, userId]);
      if (groupResult.rows[0]) return groupResult.rows[0];
    }

    const defaultQuery = `
      ${baseSelect}
      JOIN ${Tables.UPDATE_GROUPS} g ON r.update_group_id = g.id
      WHERE r.runtime_version = $1 AND g.is_default = true
      ORDER BY r.timestamp DESC
      LIMIT 1
    `;
    const defaultResult = await this.pool.query(defaultQuery, [runtimeVersion]);
    return defaultResult.rows[0] || null;
  }
```

- [ ] **Step 4: Update `createRelease` to require `updateGroupId`**

Replace the existing `createRelease` method body in `PostgresDatabase`:

```typescript
  async createRelease(release: Omit<Release, 'id' | 'updateGroupName'>): Promise<Release> {
    const query = `
      INSERT INTO ${Tables.RELEASES}
        (runtime_version, path, timestamp, commit_hash, commit_message, update_id, update_group_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, runtime_version as "runtimeVersion", path, timestamp,
                commit_hash as "commitHash", commit_message as "commitMessage",
                update_id as "updateId", update_group_id as "updateGroupId"
    `;
    const values = [
      release.runtimeVersion,
      release.path,
      release.timestamp,
      release.commitHash,
      release.commitMessage,
      release.updateId,
      release.updateGroupId,
    ];
    const { rows } = await this.pool.query(query, values);
    return rows[0];
  }
```

- [ ] **Step 5: Update `listReleases` to JOIN group name**

Replace `listReleases` in `PostgresDatabase`:

```typescript
  async listReleases(): Promise<Release[]> {
    const query = `
      SELECT r.id, r.runtime_version as "runtimeVersion", r.path, r.timestamp,
             r.commit_hash as "commitHash", r.commit_message as "commitMessage",
             r.update_id as "updateId", r.update_group_id as "updateGroupId",
             g.name as "updateGroupName"
      FROM ${Tables.RELEASES} r
      LEFT JOIN ${Tables.UPDATE_GROUPS} g ON r.update_group_id = g.id
      ORDER BY r.timestamp DESC
    `;
    const { rows } = await this.pool.query(query);
    return rows;
  }
```

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors in `LocalDatabase.ts`. Errors may remain in `SupabaseDatabase.ts` — handled in the next task.

- [ ] **Step 7: Commit**

```bash
git add apiUtils/database/LocalDatabase.ts
git commit -m "feat(db): postgres implementation for update groups"
```

---

## Task 4: Supabase implementation — parity

**Files:**
- Modify: `apiUtils/database/SupabaseDatabase.ts`

- [ ] **Step 1: Update imports**

At the top of `apiUtils/database/SupabaseDatabase.ts`, replace the imports:

```typescript
import { createClient } from '@supabase/supabase-js';

import {
  DatabaseInterface,
  Release,
  Tracking,
  TrackingMetrics,
  UpdateGroup,
  UpdateGroupMember,
} from './DatabaseInterface';
import { Tables } from './DatabaseFactory';
```

- [ ] **Step 2: Add group CRUD methods to `SupabaseDatabase`**

Append inside the class:

```typescript
  async listUpdateGroups(): Promise<UpdateGroup[]> {
    const { data, error } = await this.supabase
      .from(Tables.UPDATE_GROUPS)
      .select()
      .order('is_default', { ascending: false })
      .order('name', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      isDefault: g.is_default,
      createdAt: g.created_at,
    }));
  }

  async getUpdateGroup(id: string): Promise<UpdateGroup | null> {
    const { data, error } = await this.supabase
      .from(Tables.UPDATE_GROUPS)
      .select()
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return { id: data.id, name: data.name, isDefault: data.is_default, createdAt: data.created_at };
  }

  async getUpdateGroupByName(name: string): Promise<UpdateGroup | null> {
    const { data, error } = await this.supabase
      .from(Tables.UPDATE_GROUPS)
      .select()
      .eq('name', name)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return { id: data.id, name: data.name, isDefault: data.is_default, createdAt: data.created_at };
  }

  async getDefaultUpdateGroup(): Promise<UpdateGroup> {
    const { data, error } = await this.supabase
      .from(Tables.UPDATE_GROUPS)
      .select()
      .eq('is_default', true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('No default update group configured');
    return { id: data.id, name: data.name, isDefault: data.is_default, createdAt: data.created_at };
  }

  async createUpdateGroup(name: string): Promise<UpdateGroup> {
    const { data, error } = await this.supabase
      .from(Tables.UPDATE_GROUPS)
      .insert({ name })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { id: data.id, name: data.name, isDefault: data.is_default, createdAt: data.created_at };
  }

  async deleteUpdateGroup(id: string): Promise<void> {
    const { error } = await this.supabase
      .from(Tables.UPDATE_GROUPS)
      .delete()
      .eq('id', id);
    if (error) throw new Error(error.message);
  }
```

- [ ] **Step 3: Add membership methods**

```typescript
  async listGroupMembers(updateGroupId: string): Promise<UpdateGroupMember[]> {
    const { data, error } = await this.supabase
      .from(Tables.UPDATE_GROUP_MEMBERS)
      .select()
      .eq('update_group_id', updateGroupId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((m) => ({
      updateGroupId: m.update_group_id,
      userId: m.user_id,
      createdAt: m.created_at,
    }));
  }

  async addUserToGroup(updateGroupId: string, userId: string): Promise<void> {
    const { error } = await this.supabase
      .from(Tables.UPDATE_GROUP_MEMBERS)
      .upsert(
        { update_group_id: updateGroupId, user_id: userId },
        { onConflict: 'update_group_id,user_id', ignoreDuplicates: true }
      );
    if (error) throw new Error(error.message);
  }

  async removeUserFromGroup(updateGroupId: string, userId: string): Promise<void> {
    const { error } = await this.supabase
      .from(Tables.UPDATE_GROUP_MEMBERS)
      .delete()
      .eq('update_group_id', updateGroupId)
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
  }
```

- [ ] **Step 4: Add resolver**

```typescript
  async getLatestReleaseForUser(
    runtimeVersion: string,
    userId: string | null
  ): Promise<Release | null> {
    if (userId) {
      const { data: memberships, error: memErr } = await this.supabase
        .from(Tables.UPDATE_GROUP_MEMBERS)
        .select('update_group_id')
        .eq('user_id', userId);
      if (memErr) throw new Error(memErr.message);

      const groupIds = (memberships ?? []).map((m: { update_group_id: string }) => m.update_group_id);
      if (groupIds.length > 0) {
        const { data, error } = await this.supabase
          .from(Tables.RELEASES)
          .select()
          .eq('runtime_version', runtimeVersion)
          .in('update_group_id', groupIds)
          .order('timestamp', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (data) return this.mapReleaseRow(data);
      }
    }

    const defaultGroup = await this.getDefaultUpdateGroup();
    const { data, error } = await this.supabase
      .from(Tables.RELEASES)
      .select()
      .eq('runtime_version', runtimeVersion)
      .eq('update_group_id', defaultGroup.id)
      .order('timestamp', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? this.mapReleaseRow(data) : null;
  }

  private mapReleaseRow(row: Record<string, unknown>): Release {
    return {
      id: row.id as string,
      runtimeVersion: row.runtime_version as string,
      path: row.path as string,
      timestamp: row.timestamp as string,
      commitHash: row.commit_hash as string,
      commitMessage: row.commit_message as string,
      updateId: row.update_id as string | undefined,
      updateGroupId: row.update_group_id as string,
    };
  }
```

- [ ] **Step 5: Update `createRelease` to include `update_group_id`**

Replace the existing `createRelease` body:

```typescript
  async createRelease(release: Omit<Release, 'id' | 'updateGroupName'>): Promise<Release> {
    const { data, error } = await this.supabase
      .from(Tables.RELEASES)
      .insert({
        path: release.path,
        runtime_version: release.runtimeVersion,
        timestamp: release.timestamp,
        commit_hash: release.commitHash,
        commit_message: release.commitMessage,
        update_id: release.updateId,
        update_group_id: release.updateGroupId,
      })
      .select()
      .single();
    if (error) throw error;
    return this.mapReleaseRow(data);
  }
```

- [ ] **Step 6: Update `listReleases` to include group name**

Replace `listReleases`:

```typescript
  async listReleases(): Promise<Release[]> {
    const { data, error } = await this.supabase
      .from(Tables.RELEASES)
      .select(`*, ${Tables.UPDATE_GROUPS}(name)`)
      .order('timestamp', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r) => ({
      id: r.id,
      path: r.path,
      runtimeVersion: r.runtime_version,
      timestamp: r.timestamp,
      commitHash: r.commit_hash,
      commitMessage: r.commit_message,
      updateId: r.update_id,
      updateGroupId: r.update_group_id,
      updateGroupName: r[Tables.UPDATE_GROUPS]?.name,
    }));
  }
```

- [ ] **Step 7: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apiUtils/database/SupabaseDatabase.ts
git commit -m "feat(db): supabase implementation for update groups"
```

---

## Task 5: API endpoints — groups CRUD

**Files:**
- Create: `pages/api/update-groups/index.ts`
- Create: `pages/api/update-groups/[id].ts`
- Create: `__tests__/updateGroups.test.ts`

- [ ] **Step 1: Write failing tests for the index endpoint**

Create `__tests__/updateGroups.test.ts`:

```typescript
import { createMocks } from 'node-mocks-http';

import { DatabaseFactory } from '../apiUtils/database/DatabaseFactory';
import indexHandler from '../pages/api/update-groups/index';
import idHandler from '../pages/api/update-groups/[id]';

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

    const { req, res } = createMocks({ method: 'GET' });
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
    });
    await indexHandler(req, res);

    expect(db.createUpdateGroup).toHaveBeenCalledWith('alpha');
    expect(res._getStatusCode()).toBe(201);
    expect(JSON.parse(res._getData())).toEqual({ group: created });
  });

  it('POST /api/update-groups rejects missing name', async () => {
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue({});
    const { req, res } = createMocks({ method: 'POST', body: {} });
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

    const { req, res } = createMocks({ method: 'DELETE', query: { id: 'g1' } });
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

    const { req, res } = createMocks({ method: 'DELETE', query: { id: 'g2' } });
    await idHandler(req, res);

    expect(db.deleteUpdateGroup).toHaveBeenCalledWith('g2');
    expect(res._getStatusCode()).toBe(204);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
yarn test __tests__/updateGroups.test.ts
```

Expected: failures because the endpoint files don't exist.

- [ ] **Step 3: Implement the index endpoint**

Create `pages/api/update-groups/index.ts`:

```typescript
import { NextApiRequest, NextApiResponse } from 'next';

import { DatabaseFactory } from '../../../apiUtils/database/DatabaseFactory';
import { getLogger } from '../../../apiUtils/logger';

const logger = getLogger('updateGroups');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = DatabaseFactory.getDatabase();

  if (req.method === 'GET') {
    try {
      const groups = await db.listUpdateGroups();
      res.status(200).json({ groups });
    } catch (error) {
      logger.error(error);
      res.status(500).json({ error: 'Failed to list update groups' });
    }
    return;
  }

  if (req.method === 'POST') {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) {
      res.status(400).json({ error: 'Missing or empty `name`' });
      return;
    }
    try {
      const group = await db.createUpdateGroup(name);
      res.status(201).json({ group });
    } catch (error) {
      logger.error(error);
      res.status(500).json({ error: 'Failed to create update group' });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
```

- [ ] **Step 4: Implement the [id] endpoint**

Create `pages/api/update-groups/[id].ts`:

```typescript
import { NextApiRequest, NextApiResponse } from 'next';

import { DatabaseFactory } from '../../../apiUtils/database/DatabaseFactory';
import { getLogger } from '../../../apiUtils/logger';

const logger = getLogger('updateGroup');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  if (typeof id !== 'string') {
    res.status(400).json({ error: 'Missing id' });
    return;
  }

  const db = DatabaseFactory.getDatabase();

  if (req.method === 'DELETE') {
    try {
      const group = await db.getUpdateGroup(id);
      if (!group) {
        res.status(404).json({ error: 'Update group not found' });
        return;
      }
      if (group.isDefault) {
        res.status(400).json({ error: 'Cannot delete the default update group' });
        return;
      }
      await db.deleteUpdateGroup(id);
      res.status(204).end();
    } catch (error) {
      logger.error(error);
      res.status(500).json({ error: 'Failed to delete update group' });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
```

- [ ] **Step 5: Run tests, verify they pass**

```bash
yarn test __tests__/updateGroups.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add pages/api/update-groups/index.ts pages/api/update-groups/[id].ts __tests__/updateGroups.test.ts
git commit -m "feat(api): update groups CRUD endpoints"
```

---

## Task 6: API endpoints — group membership

**Files:**
- Create: `pages/api/update-groups/[id]/members.ts`
- Create: `__tests__/updateGroupMembers.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/updateGroupMembers.test.ts`:

```typescript
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

    expect(db.addUserToGroup).toHaveBeenCalledWith('g1', 'u42');
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
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
yarn test __tests__/updateGroupMembers.test.ts
```

Expected: cannot find handler.

- [ ] **Step 3: Implement the members handler**

Create `pages/api/update-groups/[id]/members.ts`:

```typescript
import { NextApiRequest, NextApiResponse } from 'next';

import { DatabaseFactory } from '../../../../apiUtils/database/DatabaseFactory';
import { getLogger } from '../../../../apiUtils/logger';

const logger = getLogger('updateGroupMembers');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  if (typeof id !== 'string') {
    res.status(400).json({ error: 'Missing id' });
    return;
  }

  const db = DatabaseFactory.getDatabase();
  const group = await db.getUpdateGroup(id);
  if (!group) {
    res.status(404).json({ error: 'Update group not found' });
    return;
  }

  if (req.method === 'GET') {
    try {
      const members = await db.listGroupMembers(id);
      res.status(200).json({ members });
    } catch (error) {
      logger.error(error);
      res.status(500).json({ error: 'Failed to list members' });
    }
    return;
  }

  if (req.method === 'POST') {
    if (group.isDefault) {
      res.status(400).json({ error: 'The default group has implicit membership and cannot have explicit members' });
      return;
    }
    const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
    if (!userId) {
      res.status(400).json({ error: 'Missing or empty `userId`' });
      return;
    }
    try {
      await db.addUserToGroup(id, userId);
      res.status(204).end();
    } catch (error) {
      logger.error(error);
      res.status(500).json({ error: 'Failed to add member' });
    }
    return;
  }

  if (req.method === 'DELETE') {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
    if (!userId) {
      res.status(400).json({ error: 'Missing `userId` query parameter' });
      return;
    }
    try {
      await db.removeUserFromGroup(id, userId);
      res.status(204).end();
    } catch (error) {
      logger.error(error);
      res.status(500).json({ error: 'Failed to remove member' });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
yarn test __tests__/updateGroupMembers.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add pages/api/update-groups/[id]/members.ts __tests__/updateGroupMembers.test.ts
git commit -m "feat(api): update group membership endpoints"
```

---

## Task 7: Manifest endpoint — read user header, use resolver

**Files:**
- Modify: `pages/api/manifest.ts`
- Modify: `apiUtils/helpers/UpdateHelper.ts`
- Modify: `__tests__/manifest.test.ts`

The manifest endpoint currently calls `UpdateHelper.getLatestUpdateBundlePathForRuntimeVersionAsync(runtimeVersion)`. We need that helper to consult the resolver so the chosen *bundle path* matches the resolved release.

- [ ] **Step 1: Inspect the helper to understand current behavior**

Read `apiUtils/helpers/UpdateHelper.ts` lines 1–50 to see how `getLatestUpdateBundlePathForRuntimeVersionAsync` is implemented. It currently lists files in storage and picks the newest. We will replace this logic with a DB-driven lookup.

- [ ] **Step 2: Add a new resolver-based helper method**

Edit `apiUtils/helpers/UpdateHelper.ts`. Add a static method on `UpdateHelper`:

```typescript
  static async getResolvedUpdateBundlePathAsync(
    runtimeVersion: string,
    userId: string | null
  ): Promise<string> {
    const release = await DatabaseFactory.getDatabase().getLatestReleaseForUser(
      runtimeVersion,
      userId
    );
    if (!release) {
      throw new NoUpdateAvailableError();
    }
    // The path stored in the DB ends in `.zip`; the helper signature expects a path
    // without the extension (matching prior behavior of `getLatestUpdateBundlePathForRuntimeVersionAsync`).
    return release.path.replace(/\.zip$/, '');
  }
```

If `DatabaseFactory` is not already imported at the top of the file, add:

```typescript
import { DatabaseFactory } from '../database/DatabaseFactory';
```

Leave `getLatestUpdateBundlePathForRuntimeVersionAsync` in place — it may still be used elsewhere; do not delete it in this task.

- [ ] **Step 3: Update the manifest endpoint**

Edit `pages/api/manifest.ts`. Replace lines 24–94 (the request-validation and bundle-resolution block) — concretely, two surgical edits:

First, replace the logging block at the top of the handler (around line 24):

```typescript
  const userId =
    typeof req.headers['xavia-user-id'] === 'string' && req.headers['xavia-user-id']
      ? (req.headers['xavia-user-id'] as string)
      : null;

  logger.info('A client requested a release', {
    runtimeVersion: req.headers['expo-runtime-version'],
    platform: req.headers['expo-platform'],
    protocolVersion: req.headers['expo-protocol-version'],
    apiVersion: req.headers['expo-api-version'],
    currentUpdateId: req.headers['expo-current-update-id'],
    userId,
  });
```

Second, replace the database lookup block (currently lines 61–94 — the call to `getLatestReleaseRecordForRuntimeVersion` and `UpdateHelper.getLatestUpdateBundlePathForRuntimeVersionAsync`) with:

```typescript
  const database = DatabaseFactory.getDatabase();
  const releaseRecord = await database.getLatestReleaseForUser(runtimeVersion, userId);

  if (releaseRecord) {
    const updateId = releaseRecord.updateId;
    const currentUpdateId = req.headers['expo-current-update-id'];
    if (currentUpdateId === updateId) {
      logger.info('User is already running the latest release. Returning NoUpdateAvailable.', {
        runtimeVersion,
        userId,
      });
      await putNoUpdateAvailableInResponseAsync(req, res, protocolVersion);
      return;
    }
  }

  let updateBundlePath: string;
  try {
    updateBundlePath = await UpdateHelper.getResolvedUpdateBundlePathAsync(runtimeVersion, userId);
  } catch (error: any) {
    if (error instanceof NoUpdateAvailableError) {
      logger.info('No update available for runtime version', { runtimeVersion, userId });
      await putNoUpdateAvailableInResponseAsync(req, res, protocolVersion);
      return;
    }
    res.statusCode = 404;
    res.json({ error: error.message });
    return;
  }
```

- [ ] **Step 4: Add manifest tests for group resolution**

Append to `__tests__/manifest.test.ts` (inside the existing `describe` block):

```typescript
  it('passes xavia-user-id to the resolver', async () => {
    const mockRelease = {
      id: 'release-id',
      runtimeVersion: '1.0.0',
      path: 'updates/1.0.0/x.zip',
      timestamp: '2024-03-20T00:00:00Z',
      commitHash: 'abc',
      commitMessage: 'msg',
      updateId: 'uid-1',
      updateGroupId: 'g-beta',
    };
    const getLatestReleaseForUser = jest.fn().mockResolvedValue(mockRelease);
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue({
      getLatestReleaseForUser,
    });

    (UpdateHelper.getResolvedUpdateBundlePathAsync as jest.Mock) = jest
      .fn()
      .mockResolvedValue('updates/1.0.0/x');

    const { req, res } = createMocks({
      method: 'GET',
      headers: {
        'expo-platform': 'ios',
        'expo-runtime-version': '1.0.0',
        'expo-protocol-version': '1',
        'expo-current-update-id': 'uid-1',
        'xavia-user-id': 'user-42',
      },
    });

    await manifestEndpoint(req, res);

    expect(getLatestReleaseForUser).toHaveBeenCalledWith('1.0.0', 'user-42');
    expect(res._getStatusCode()).toBe(200);
  });

  it('treats missing xavia-user-id as anonymous (null userId)', async () => {
    const getLatestReleaseForUser = jest.fn().mockResolvedValue(null);
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue({
      getLatestReleaseForUser,
    });
    (UpdateHelper.getResolvedUpdateBundlePathAsync as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new NoUpdateAvailableError());

    const { req, res } = createMocks({
      method: 'GET',
      headers: {
        'expo-platform': 'ios',
        'expo-runtime-version': '1.0.0',
        'expo-protocol-version': '1',
      },
    });

    await manifestEndpoint(req, res);

    expect(getLatestReleaseForUser).toHaveBeenCalledWith('1.0.0', null);
  });
```

- [ ] **Step 5: Run all manifest tests**

```bash
yarn test __tests__/manifest.test.ts
```

Expected: all tests pass. Snapshot tests may need updating — review the diff and run `yarn test -u __tests__/manifest.test.ts` if the only changes are additive log fields.

- [ ] **Step 6: Type-check and lint**

```bash
npx tsc --noEmit
yarn lint
```

- [ ] **Step 7: Commit**

```bash
git add pages/api/manifest.ts apiUtils/helpers/UpdateHelper.ts __tests__/manifest.test.ts
git commit -m "feat(manifest): resolve releases per user via update groups"
```

---

## Task 8: Upload — accept `updateGroup` name field

**Files:**
- Modify: `pages/api/upload.ts`
- Modify: `__tests__/upload.test.ts`

- [ ] **Step 1: Add a failing test**

Open `__tests__/upload.test.ts`. Add inside the `describe('Upload API', ...)` block:

```typescript
  it('uses the named update group when provided', async () => {
    const mockForm = {
      parse: jest.fn().mockResolvedValue([
        {
          uploadKey: [process.env.UPLOAD_KEY],
          runtimeVersion: ['1.0.0'],
          commitHash: ['abc123'],
          commitMessage: ['m'],
          updateGroup: ['beta'],
        },
        { file: [{ filepath: 'test.zip' }] },
      ]),
    };
    (formidable as unknown as jest.Mock).mockReturnValue(mockForm);

    jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('x'));
    (AdmZip as unknown as jest.Mock).mockImplementation(() => ({} as AdmZip));
    (ZipHelper.getFileFromZip as jest.Mock).mockResolvedValue(Buffer.from('{}'));
    (HashHelper.createHash as jest.Mock).mockReturnValue('hash');
    (HashHelper.convertSHA256HashToUUID as jest.Mock).mockReturnValue('uid');

    const mockStorage = { uploadFile: jest.fn().mockResolvedValue('updates/1.0.0/t.zip') };
    const createRelease = jest.fn().mockResolvedValue({});
    const mockDatabase = {
      getUpdateGroupByName: jest.fn().mockResolvedValue({
        id: 'g-beta', name: 'beta', isDefault: false, createdAt: 't',
      }),
      getDefaultUpdateGroup: jest.fn(),
      createRelease,
    };
    (StorageFactory.getStorage as jest.Mock).mockReturnValue(mockStorage);
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(mockDatabase);

    const { req, res } = createMocks({ method: 'POST' });
    await uploadHandler(req, res);

    expect(mockDatabase.getUpdateGroupByName).toHaveBeenCalledWith('beta');
    expect(mockDatabase.getDefaultUpdateGroup).not.toHaveBeenCalled();
    expect(createRelease).toHaveBeenCalledWith(expect.objectContaining({ updateGroupId: 'g-beta' }));
    expect(res._getStatusCode()).toBe(200);
  });

  it('falls back to the default group when updateGroup is omitted', async () => {
    const mockForm = {
      parse: jest.fn().mockResolvedValue([
        {
          uploadKey: [process.env.UPLOAD_KEY],
          runtimeVersion: ['1.0.0'],
          commitHash: ['abc'],
          commitMessage: ['m'],
        },
        { file: [{ filepath: 'test.zip' }] },
      ]),
    };
    (formidable as unknown as jest.Mock).mockReturnValue(mockForm);

    jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('x'));
    (AdmZip as unknown as jest.Mock).mockImplementation(() => ({} as AdmZip));
    (ZipHelper.getFileFromZip as jest.Mock).mockResolvedValue(Buffer.from('{}'));
    (HashHelper.createHash as jest.Mock).mockReturnValue('hash');
    (HashHelper.convertSHA256HashToUUID as jest.Mock).mockReturnValue('uid');

    const createRelease = jest.fn().mockResolvedValue({});
    const mockDatabase = {
      getUpdateGroupByName: jest.fn(),
      getDefaultUpdateGroup: jest.fn().mockResolvedValue({
        id: 'g-prod', name: 'production', isDefault: true, createdAt: 't',
      }),
      createRelease,
    };
    (StorageFactory.getStorage as jest.Mock).mockReturnValue({
      uploadFile: jest.fn().mockResolvedValue('updates/1.0.0/t.zip'),
    });
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(mockDatabase);

    const { req, res } = createMocks({ method: 'POST' });
    await uploadHandler(req, res);

    expect(mockDatabase.getDefaultUpdateGroup).toHaveBeenCalled();
    expect(createRelease).toHaveBeenCalledWith(expect.objectContaining({ updateGroupId: 'g-prod' }));
  });

  it('rejects with 400 when updateGroup name is unknown', async () => {
    const mockForm = {
      parse: jest.fn().mockResolvedValue([
        {
          uploadKey: [process.env.UPLOAD_KEY],
          runtimeVersion: ['1.0.0'],
          commitHash: ['abc'],
          commitMessage: ['m'],
          updateGroup: ['nonexistent'],
        },
        { file: [{ filepath: 'test.zip' }] },
      ]),
    };
    (formidable as unknown as jest.Mock).mockReturnValue(mockForm);

    const mockDatabase = {
      getUpdateGroupByName: jest.fn().mockResolvedValue(null),
    };
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(mockDatabase);

    const { req, res } = createMocks({ method: 'POST' });
    await uploadHandler(req, res);

    expect(res._getStatusCode()).toBe(400);
  });
```

- [ ] **Step 2: Run tests, confirm failure**

```bash
yarn test __tests__/upload.test.ts
```

Expected: the new tests fail.

- [ ] **Step 3: Implement the change in `pages/api/upload.ts`**

Replace the body inside the `try { ... }` block of `pages/api/upload.ts` from after the upload-key check through the `createRelease` call. The full revised handler body:

```typescript
    const [fields, files] = await form.parse(req);
    const uploadKey = fields.uploadKey?.[0] || null;
    const file = files.file?.[0];
    const runtimeVersion = fields.runtimeVersion?.[0];
    const commitHash = fields.commitHash?.[0];
    const commitMessage = fields.commitMessage?.[0] || 'No message provided';
    const updateGroupName = fields.updateGroup?.[0];

    if (!uploadKey || !file || !runtimeVersion || !commitHash) {
      res.status(400).json({ error: 'Missing upload key, file, runtime version or commit hash' });
      return;
    }

    if (process.env.UPLOAD_KEY !== uploadKey) {
      res.status(400).json({ error: 'Upload failed: wrong upload key' });
      return;
    }

    const database = DatabaseFactory.getDatabase();
    let updateGroup;
    if (updateGroupName) {
      updateGroup = await database.getUpdateGroupByName(updateGroupName);
      if (!updateGroup) {
        res.status(400).json({ error: `Unknown update group: ${updateGroupName}` });
        return;
      }
    } else {
      updateGroup = await database.getDefaultUpdateGroup();
    }

    const storage = StorageFactory.getStorage();
    const timestamp = moment().utc().format('YYYYMMDDHHmmss');
    const updatePath = `updates/${runtimeVersion}`;

    const zipContent = fs.readFileSync(file.filepath);
    const zipFolder = new AdmZip(file.filepath);
    const metadataJsonFile = await ZipHelper.getFileFromZip(zipFolder, 'metadata.json');

    const updateHash = HashHelper.createHash(metadataJsonFile, 'sha256', 'hex');
    const updateId = HashHelper.convertSHA256HashToUUID(updateHash);

    const path = await storage.uploadFile(`${updatePath}/${timestamp}.zip`, zipContent);

    await database.createRelease({
      path,
      runtimeVersion,
      timestamp: moment().utc().toString(),
      commitHash,
      commitMessage,
      updateId,
      updateGroupId: updateGroup.id,
    });

    res.status(200).json({ success: true, path });
```

- [ ] **Step 4: Run tests**

```bash
yarn test __tests__/upload.test.ts
```

Expected: all tests pass (including pre-existing snapshots — none of them touch the new field).

- [ ] **Step 5: Commit**

```bash
git add pages/api/upload.ts __tests__/upload.test.ts
git commit -m "feat(upload): accept updateGroup name field"
```

---

## Task 9: Rollback — inherit/override group

**Files:**
- Modify: `pages/api/rollback.ts`
- Modify: `__tests__/rollback.test.ts`

- [ ] **Step 1: Add failing tests**

Open `__tests__/rollback.test.ts`. Add inside the existing `describe` block:

```typescript
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
```

If the test file does not already import the relevant modules, add at the top:

```typescript
import { DatabaseFactory } from '../apiUtils/database/DatabaseFactory';
import { StorageFactory } from '../apiUtils/storage/StorageFactory';
import rollbackHandler from '../pages/api/rollback';

jest.mock('../apiUtils/database/DatabaseFactory');
jest.mock('../apiUtils/storage/StorageFactory');
```

(They are likely already there — only add what is missing.)

- [ ] **Step 2: Run tests, confirm failure**

```bash
yarn test __tests__/rollback.test.ts
```

- [ ] **Step 3: Update `pages/api/rollback.ts`**

Replace the file with:

```typescript
import moment from 'moment';
import { NextApiRequest, NextApiResponse } from 'next';

import { DatabaseFactory } from '../../apiUtils/database/DatabaseFactory';
import { StorageFactory } from '../../apiUtils/storage/StorageFactory';

export default async function rollbackHandler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { path, runtimeVersion, commitHash, commitMessage, updateGroup: overrideGroupName } = req.body;

  if (!path) {
    res.status(400).json({ error: 'Missing path' });
    return;
  }
  if (!runtimeVersion) {
    res.status(400).json({ error: 'Missing runtimeVersion' });
    return;
  }
  if (!commitHash) {
    res.status(400).json({ error: 'Missing commitHash' });
    return;
  }

  try {
    const database = DatabaseFactory.getDatabase();
    const storage = StorageFactory.getStorage();

    let updateGroupId: string;
    if (overrideGroupName) {
      const overrideGroup = await database.getUpdateGroupByName(overrideGroupName);
      if (!overrideGroup) {
        res.status(400).json({ error: `Unknown update group: ${overrideGroupName}` });
        return;
      }
      updateGroupId = overrideGroup.id;
    } else {
      const sourceRelease = await database.getReleaseByPath(path);
      if (sourceRelease?.updateGroupId) {
        updateGroupId = sourceRelease.updateGroupId;
      } else {
        const defaultGroup = await database.getDefaultUpdateGroup();
        updateGroupId = defaultGroup.id;
      }
    }

    const timestamp = moment().utc().format('YYYYMMDDHHmmss');
    const newPath = `updates/${runtimeVersion}/${timestamp}.zip`;

    await storage.copyFile(path, newPath);

    await database.createRelease({
      path: newPath,
      runtimeVersion,
      timestamp: moment().utc().toString(),
      commitHash,
      commitMessage,
      updateGroupId,
    });

    res.status(200).json({ success: true, newPath });
  } catch (error) {
    console.error('Rollback error:', error);
    res.status(500).json({ error: 'Rollback failed' });
  }
}
```

- [ ] **Step 4: Run tests**

```bash
yarn test __tests__/rollback.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add pages/api/rollback.ts __tests__/rollback.test.ts
git commit -m "feat(rollback): inherit/override update group"
```

---

## Task 10: Releases listing — include group name

**Files:**
- Modify: `pages/api/releases.ts`
- Modify: `__tests__/releases.test.ts`

- [ ] **Step 1: Update the release-mapping logic**

Edit `pages/api/releases.ts`. Replace the `releases.push({...})` block (around lines 26–35) with:

```typescript
        releases.push({
          path: release?.path || `${folderPath}/${file.name}`,
          runtimeVersion,
          timestamp: file.created_at,
          size: file.metadata.size,
          commitHash,
          commitMessage: release?.commitMessage,
          updateGroupId: release?.updateGroupId,
          updateGroupName: release?.updateGroupName,
        });
```

- [ ] **Step 2: Add a test confirming the new fields propagate**

Open `__tests__/releases.test.ts`. Add a test inside the existing `describe`:

```typescript
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
```

If `releasesHandler` and the factory mocks aren't already imported, add them.

- [ ] **Step 3: Run tests**

```bash
yarn test __tests__/releases.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add pages/api/releases.ts __tests__/releases.test.ts
git commit -m "feat(releases): expose update group fields in listing"
```

---

## Task 11: Dashboard — groups admin page

**Files:**
- Create: `pages/update-groups.tsx`

This page is a thin Chakra UI form over the API endpoints written in Tasks 5 & 6. Follow the patterns in `pages/releases.tsx` for layout (Layout component, Chakra primitives, toast on success/error). No tests — UI verification is manual.

- [ ] **Step 1: Read the existing dashboard pages for style reference**

```bash
head -80 pages/releases.tsx
head -40 pages/dashboard.tsx
```

Note the use of `Layout`, `ProtectedRoute`, `useToast` (or `showToast` from `components/toast`).

- [ ] **Step 2: Implement `pages/update-groups.tsx`**

Create `pages/update-groups.tsx`:

```tsx
import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Flex,
  Heading,
  HStack,
  Input,
  List,
  ListItem,
  Spinner,
  Text,
  VStack,
} from '@chakra-ui/react';

import Layout from '../components/Layout';
import ProtectedRoute from '../components/ProtectedRoute';
import { showToast } from '../components/toast';

type UpdateGroup = {
  id: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
};

type Member = { updateGroupId: string; userId: string; createdAt: string };

export default function UpdateGroupsPage() {
  const [groups, setGroups] = useState<UpdateGroup[] | null>(null);
  const [newName, setNewName] = useState('');
  const [selected, setSelected] = useState<UpdateGroup | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [newMemberId, setNewMemberId] = useState('');

  async function refreshGroups() {
    const res = await fetch('/api/update-groups');
    const json = await res.json();
    setGroups(json.groups);
  }

  async function refreshMembers(group: UpdateGroup) {
    const res = await fetch(`/api/update-groups/${group.id}/members`);
    const json = await res.json();
    setMembers(json.members);
  }

  useEffect(() => { refreshGroups(); }, []);
  useEffect(() => { if (selected) refreshMembers(selected); }, [selected]);

  async function createGroup() {
    if (!newName.trim()) return;
    const res = await fetch('/api/update-groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    });
    if (!res.ok) {
      showToast('Failed to create group', 'error');
      return;
    }
    setNewName('');
    showToast('Group created', 'success');
    refreshGroups();
  }

  async function deleteGroup(group: UpdateGroup) {
    if (!confirm(`Delete group "${group.name}"?`)) return;
    const res = await fetch(`/api/update-groups/${group.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.error ?? 'Failed to delete group', 'error');
      return;
    }
    if (selected?.id === group.id) setSelected(null);
    refreshGroups();
  }

  async function addMember() {
    if (!selected || !newMemberId.trim()) return;
    const res = await fetch(`/api/update-groups/${selected.id}/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: newMemberId.trim() }),
    });
    if (!res.ok) {
      showToast('Failed to add member', 'error');
      return;
    }
    setNewMemberId('');
    refreshMembers(selected);
  }

  async function removeMember(userId: string) {
    if (!selected) return;
    const res = await fetch(
      `/api/update-groups/${selected.id}/members?userId=${encodeURIComponent(userId)}`,
      { method: 'DELETE' }
    );
    if (!res.ok) {
      showToast('Failed to remove member', 'error');
      return;
    }
    refreshMembers(selected);
  }

  return (
    <ProtectedRoute>
      <Layout>
        <Heading mb={6}>Update Groups</Heading>
        <Flex gap={8} align="flex-start">
          <Box flex="1">
            <Heading size="md" mb={3}>Groups</Heading>
            {groups === null ? (
              <Spinner />
            ) : (
              <List spacing={2}>
                {groups.map((g) => (
                  <ListItem
                    key={g.id}
                    p={3}
                    borderWidth="1px"
                    borderRadius="md"
                    cursor="pointer"
                    bg={selected?.id === g.id ? 'gray.50' : undefined}
                    onClick={() => setSelected(g)}
                  >
                    <HStack justify="space-between">
                      <Text fontWeight="medium">
                        {g.name}{g.isDefault ? ' (default)' : ''}
                      </Text>
                      {!g.isDefault && (
                        <Button size="xs" colorScheme="red" onClick={(e) => { e.stopPropagation(); deleteGroup(g); }}>
                          Delete
                        </Button>
                      )}
                    </HStack>
                  </ListItem>
                ))}
              </List>
            )}
            <HStack mt={4}>
              <Input
                placeholder="New group name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <Button onClick={createGroup}>Create</Button>
            </HStack>
          </Box>

          <Box flex="1">
            <Heading size="md" mb={3}>
              {selected ? `Members of "${selected.name}"` : 'Select a group'}
            </Heading>
            {selected && (
              <VStack align="stretch" spacing={2}>
                {selected.isDefault ? (
                  <Text color="gray.600">
                    The default group has implicit membership — every user is in it.
                  </Text>
                ) : (
                  <>
                    {members.length === 0 ? (
                      <Text color="gray.600">No members yet.</Text>
                    ) : (
                      <List spacing={2}>
                        {members.map((m) => (
                          <ListItem key={m.userId} p={2} borderWidth="1px" borderRadius="md">
                            <HStack justify="space-between">
                              <Text>{m.userId}</Text>
                              <Button size="xs" colorScheme="red" onClick={() => removeMember(m.userId)}>
                                Remove
                              </Button>
                            </HStack>
                          </ListItem>
                        ))}
                      </List>
                    )}
                    <HStack>
                      <Input
                        placeholder="User id"
                        value={newMemberId}
                        onChange={(e) => setNewMemberId(e.target.value)}
                      />
                      <Button onClick={addMember}>Add</Button>
                    </HStack>
                  </>
                )}
              </VStack>
            )}
          </Box>
        </Flex>
      </Layout>
    </ProtectedRoute>
  );
}
```

- [ ] **Step 3: Verify the page renders against a local DB**

```bash
docker-compose -f containers/database/docker-compose.yml down -v
docker-compose -f containers/database/docker-compose.yml up -d
yarn dev
```

Visit `http://localhost:3001/update-groups`, log in, and verify:
- The `production` (default) group is listed with the "default" tag and no Delete button.
- You can create a new group, add a fake user id, and remove the member.

- [ ] **Step 4: Type-check and lint**

```bash
npx tsc --noEmit
yarn lint
```

- [ ] **Step 5: Commit**

```bash
git add pages/update-groups.tsx
git commit -m "feat(dashboard): groups admin page"
```

---

## Task 12: Dashboard — group selector in upload, badge in releases list

**Files:**
- Modify: `pages/releases.tsx`
- Modify: `components/Layout.tsx` (only if it has a nav menu)

The releases page currently contains the upload form. We add a group selector populated from `/api/update-groups`, and a small badge on each release card showing its group.

- [ ] **Step 1: Inspect the upload form section of `pages/releases.tsx`**

Read `pages/releases.tsx` to locate the upload form (look for the field where `runtimeVersion` is captured; the group selector will sit next to it).

- [ ] **Step 2: Add the group selector**

In the form-state section of `pages/releases.tsx`, add:

```typescript
const [updateGroups, setUpdateGroups] = useState<{ id: string; name: string; isDefault: boolean }[]>([]);
const [selectedGroupName, setSelectedGroupName] = useState<string>('');

useEffect(() => {
  fetch('/api/update-groups')
    .then((r) => r.json())
    .then((data) => {
      setUpdateGroups(data.groups);
      const def = data.groups.find((g: { isDefault: boolean }) => g.isDefault);
      if (def) setSelectedGroupName(def.name);
    });
}, []);
```

In the upload form JSX (next to runtimeVersion), add:

```tsx
<FormControl>
  <FormLabel>Update group</FormLabel>
  <Select
    value={selectedGroupName}
    onChange={(e) => setSelectedGroupName(e.target.value)}
  >
    {updateGroups.map((g) => (
      <option key={g.id} value={g.name}>
        {g.name}{g.isDefault ? ' (default)' : ''}
      </option>
    ))}
  </Select>
</FormControl>
```

(Add `Select`, `FormControl`, `FormLabel` to the existing `@chakra-ui/react` import if not already present.)

In the `handleSubmit` (or equivalent) function that builds the FormData for the upload POST, add:

```typescript
formData.append('updateGroup', selectedGroupName);
```

- [ ] **Step 3: Show the group on each release card**

In the JSX where each release is rendered (look for where `runtimeVersion` and `commitMessage` are displayed), add a small badge:

```tsx
{release.updateGroupName && (
  <Badge ml={2} colorScheme={release.updateGroupName === 'production' ? 'green' : 'purple'}>
    {release.updateGroupName}
  </Badge>
)}
```

(Add `Badge` to the Chakra import.)

- [ ] **Step 4: Add a navigation link if the layout supports one**

If `components/Layout.tsx` has a nav menu, add a link to `/update-groups`. Open it and follow the existing pattern. If there is no nav structure, skip this step.

- [ ] **Step 5: Manual verification**

```bash
yarn dev
```

- Upload a build with `updateGroup` selected as the new beta group; confirm in the database (or by calling `/api/releases`) that the release row references the correct group.
- View the releases list; confirm the badge shows.
- Try uploading without changing the selector; confirm the release lands in `production`.

- [ ] **Step 6: Type-check and lint**

```bash
npx tsc --noEmit
yarn lint
yarn test
```

- [ ] **Step 7: Commit**

```bash
git add pages/releases.tsx components/Layout.tsx
git commit -m "feat(dashboard): group selector + badge in releases page"
```

---

## Task 13: Final verification

- [ ] **Step 1: Run the full test suite**

```bash
yarn test
```

Expected: all tests pass. No skipped or pending tests introduced by this work.

- [ ] **Step 2: Lint and type-check**

```bash
yarn lint
npx tsc --noEmit
```

- [ ] **Step 3: Smoke test against a clean dev DB**

```bash
docker-compose -f containers/database/docker-compose.yml down -v
docker-compose -f containers/database/docker-compose.yml up -d
yarn dev
```

Manually exercise:
1. `/update-groups` — create a `beta` group; add a fake user id `u-test`.
2. Upload a release with `updateGroup=beta` (use the selector or a manual `curl` POST).
3. Upload another release without specifying a group (lands in `production`).
4. Hit `/api/manifest` (or use the Expo client) with `xavia-user-id: u-test` and confirm beta is served.
5. Hit `/api/manifest` with no `xavia-user-id` and confirm production is served.
6. Remove `u-test` from `beta`; confirm the next manifest poll resolves to production.
7. Try to delete the `production` group from `/update-groups`; confirm the request is rejected.

- [ ] **Step 4: Document the new envelope for callers**

Add a note to `docs/adminPortal.md` (or create `docs/updateGroups.md` if `adminPortal.md` is unrelated) describing:
- Header `xavia-user-id` is read by `/api/manifest`.
- Upload accepts an `updateGroup` form field (name).
- Rollback accepts an `updateGroup` field; otherwise inherits the source release's group.

This is administrative documentation; one short paragraph each.

- [ ] **Step 5: Commit and (optionally) open a PR**

```bash
git add docs/
git commit -m "docs: document update groups admin workflow"
```
