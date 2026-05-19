import { Pool } from 'pg';

import {
  DatabaseInterface,
  Release,
  Tracking,
  TrackingMetrics,
  UpdateGroup,
  UpdateGroupMember,
} from './DatabaseInterface';
import { Tables } from './DatabaseFactory';

export class PostgresDatabase implements DatabaseInterface {
  private pool: Pool;

  constructor() {
    this.pool = new Pool({
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DB,
      host: process.env.POSTGRES_HOST,
      port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
    });
  }
  async getLatestReleaseRecordForRuntimeVersion(runtimeVersion: string): Promise<Release | null> {
    const query = `
      SELECT id, runtime_version as "runtimeVersion", path, timestamp, commit_hash as "commitHash"
      FROM ${Tables.RELEASES} WHERE runtime_version = $1
      ORDER BY timestamp DESC
      LIMIT 1
    `;

    const { rows } = await this.pool.query(query, [runtimeVersion]);
    return rows[0] || null;
  }
  async getReleaseByPath(path: string): Promise<Release | null> {
    const query = `
      SELECT id, runtime_version as "runtimeVersion", path, timestamp,
             commit_hash as "commitHash", commit_message as "commitMessage",
             update_id as "updateId", update_group_id as "updateGroupId",
             manifest_data as "manifestData"
      FROM ${Tables.RELEASES} WHERE path = $1
    `;
    const { rows } = await this.pool.query(query, [path]);
    return rows[0] || null;
  }

  async createTracking(tracking: Omit<Tracking, 'id'>): Promise<Tracking> {
    const query = `
      INSERT INTO ${Tables.RELEASES_TRACKING} (release_id, platform)
      VALUES ($1, $2)
      RETURNING id, release_id as "releaseId", download_timestamp as "downloadTimestamp", platform
    `;
    const values = [tracking.releaseId, tracking.platform];
    const { rows } = await this.pool.query(query, values);
    return rows[0];
  }

  async getReleaseTrackingMetrics(releaseId: string): Promise<TrackingMetrics[]> {
    const query = `
      SELECT platform, COUNT(*) as count
      FROM ${Tables.RELEASES_TRACKING}
      WHERE release_id = $1
      GROUP BY platform
    `;
    const { rows } = await this.pool.query(query, [releaseId]);
    return rows.map((row) => ({
      platform: row.platform,
      count: Number(row.count),
    }));
  }

  async getReleaseTrackingMetricsForAllReleases(): Promise<TrackingMetrics[]> {
    const query = `
      SELECT platform, COUNT(*) as count
      FROM ${Tables.RELEASES_TRACKING}
      GROUP BY platform
    `;
    const { rows } = await this.pool.query(query);
    return rows.map((row) => ({
      platform: row.platform,
      count: Number(row.count),
    }));
  }

  async createRelease(
    release: Omit<Release, 'updateGroupName'> & { id?: string }
  ): Promise<Release> {
    const columns = [
      'runtime_version',
      'path',
      'timestamp',
      'commit_hash',
      'commit_message',
      'update_id',
      'update_group_id',
      'manifest_data',
    ];
    const values: unknown[] = [
      release.runtimeVersion,
      release.path,
      release.timestamp,
      release.commitHash,
      release.commitMessage,
      release.updateId,
      release.updateGroupId,
      release.manifestData ?? null,
    ];
    if (release.id) {
      columns.unshift('id');
      values.unshift(release.id);
    }
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    const query = `
      INSERT INTO ${Tables.RELEASES} (${columns.join(', ')})
      VALUES (${placeholders})
      RETURNING id, runtime_version as "runtimeVersion", path, timestamp,
                commit_hash as "commitHash", commit_message as "commitMessage",
                update_id as "updateId", update_group_id as "updateGroupId",
                manifest_data as "manifestData"
    `;
    const { rows } = await this.pool.query(query, values);
    return rows[0];
  }

  async getRelease(id: string): Promise<Release | null> {
    const query = `
      SELECT id, runtime_version as "runtimeVersion", path, timestamp,
             commit_hash as "commitHash", commit_message as "commitMessage",
             update_id as "updateId", update_group_id as "updateGroupId",
             manifest_data as "manifestData"
      FROM ${Tables.RELEASES} WHERE id = $1
    `;

    const { rows } = await this.pool.query(query, [id]);
    return rows[0] || null;
  }

  async listReleases(): Promise<Release[]> {
    const query = `
      SELECT r.id, r.runtime_version as "runtimeVersion", r.path, r.timestamp,
             r.commit_hash as "commitHash", r.commit_message as "commitMessage",
             r.update_id as "updateId", r.update_group_id as "updateGroupId",
             r.manifest_data as "manifestData",
             g.name as "updateGroupName"
      FROM ${Tables.RELEASES} r
      LEFT JOIN ${Tables.UPDATE_GROUPS} g ON r.update_group_id = g.id
      ORDER BY r.timestamp DESC
    `;
    const { rows } = await this.pool.query(query);
    return rows;
  }

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

  async listGroupMembers(updateGroupId: string): Promise<UpdateGroupMember[]> {
    const { rows } = await this.pool.query(
      `SELECT update_group_id as "updateGroupId", user_id as "userId", label, created_at as "createdAt"
       FROM ${Tables.UPDATE_GROUP_MEMBERS} WHERE update_group_id = $1
       ORDER BY created_at DESC`,
      [updateGroupId]
    );
    return rows;
  }

  async addUserToGroup(updateGroupId: string, userId: string, label?: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${Tables.UPDATE_GROUP_MEMBERS} (update_group_id, user_id, label)
       VALUES ($1, $2, $3)
       ON CONFLICT (update_group_id, user_id) DO UPDATE SET label = EXCLUDED.label`,
      [updateGroupId, userId, label ?? null]
    );
  }

  async removeUserFromGroup(updateGroupId: string, userId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM ${Tables.UPDATE_GROUP_MEMBERS}
       WHERE update_group_id = $1 AND user_id = $2`,
      [updateGroupId, userId]
    );
  }

  async getLatestReleaseForUser(
    runtimeVersion: string,
    userId: string | null
  ): Promise<Release | null> {
    // Reachable releases for this user: anything in the default group, plus anything
    // in a non-default group the user is a member of. The LEFT JOIN to memberships
    // hits the (update_group_id, user_id) primary key index. Non-default releases
    // sort before the default fallback (booleans order FALSE < TRUE in postgres).
    const query = `
      SELECT r.id, r.runtime_version as "runtimeVersion", r.path, r.timestamp,
             r.commit_hash as "commitHash", r.commit_message as "commitMessage",
             r.update_id as "updateId", r.update_group_id as "updateGroupId",
             r.manifest_data as "manifestData"
      FROM ${Tables.RELEASES} r
      JOIN ${Tables.UPDATE_GROUPS} g ON r.update_group_id = g.id
      LEFT JOIN ${Tables.UPDATE_GROUP_MEMBERS} m
        ON m.update_group_id = r.update_group_id AND m.user_id = $2
      WHERE r.runtime_version = $1
        AND (g.is_default = true OR m.user_id IS NOT NULL)
      ORDER BY g.is_default ASC, r.timestamp DESC
      LIMIT 1
    `;
    const { rows } = await this.pool.query(query, [runtimeVersion, userId]);
    return rows[0] || null;
  }
}
