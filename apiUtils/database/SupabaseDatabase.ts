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

export class SupabaseDatabase implements DatabaseInterface {
  private supabase;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_API_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase credentials not configured');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  async getLatestReleaseRecordForRuntimeVersion(runtimeVersion: string): Promise<Release | null> {
    const { data, error } = await this.supabase
      .from(Tables.RELEASES)
      .select()
      .eq('runtime_version', runtimeVersion)
      .order('timestamp', { ascending: false })
      .limit(1)
      .single();

    if (error) throw new Error(error.message);

    if (data) {
      return {
        id: data.id,
        runtimeVersion: data.runtime_version,
        path: data.path,
        timestamp: data.timestamp,
        commitHash: data.commit_hash,
        commitMessage: data.commit_message,
        updateId: data.update_id,
        updateGroupId: data.update_group_id,
      };
    }

    return null;
  }

  async getReleaseByPath(path: string): Promise<Release | null> {
    const { data, error } = await this.supabase
      .from(Tables.RELEASES)
      .select()
      .eq('path', path)
      .single();

    if (error) throw new Error(error.message);

    if (!data) return null;
    return {
      id: data.id,
      path: data.path,
      runtimeVersion: data.runtime_version,
      timestamp: data.timestamp,
      commitHash: data.commit_hash,
      commitMessage: data.commit_message,
      updateId: data.update_id,
      updateGroupId: data.update_group_id,
    };
  }

  async getReleaseTrackingMetricsForAllReleases(): Promise<TrackingMetrics[]> {
    const { count: iosCount, error: iosError } = await this.supabase
      .from(Tables.RELEASES_TRACKING)
      .select('platform', { count: 'estimated', head: true })
      .eq('platform', 'ios');

    const { count: androidCount, error: androidError } = await this.supabase
      .from(Tables.RELEASES_TRACKING)
      .select('platform', { count: 'estimated', head: true })
      .eq('platform', 'android');

    if (iosError || androidError) throw new Error(iosError?.message || androidError?.message);
    return [
      {
        platform: 'ios',
        count: Number(iosCount),
      },
      {
        platform: 'android',
        count: Number(androidCount),
      },
    ];
  }
  async createTracking(tracking: Omit<Tracking, 'id'>): Promise<Tracking> {
    const { data, error } = await this.supabase
      .from(Tables.RELEASES_TRACKING)
      .insert({
        release_id: tracking.releaseId,
        platform: tracking.platform,
        download_timestamp: tracking.downloadTimestamp,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }
  async getReleaseTrackingMetrics(releaseId: string): Promise<TrackingMetrics[]> {
    const { count: iosCount, error: iosError } = await this.supabase
      .from(Tables.RELEASES_TRACKING)
      .select('platform', { count: 'estimated', head: true })
      .eq('release_id', releaseId)
      .eq('platform', 'ios');

    const { count: androidCount, error: androidError } = await this.supabase
      .from(Tables.RELEASES_TRACKING)
      .select('platform', { count: 'estimated', head: true })
      .eq('release_id', releaseId)
      .eq('platform', 'android');

    if (iosError || androidError) throw new Error(iosError?.message || androidError?.message);

    return [
      {
        platform: 'ios',
        count: Number(iosCount),
      },
      {
        platform: 'android',
        count: Number(androidCount),
      },
    ];
  }

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

  async getRelease(id: string): Promise<Release | null> {
    const { data, error } = await this.supabase
      .from(Tables.RELEASES)
      .select()
      .eq('id', id)
      .single();

    if (error) throw error;

    return {
      id: data.id,
      path: data.path,
      runtimeVersion: data.runtime_version,
      timestamp: data.timestamp,
      commitHash: data.commit_hash,
      commitMessage: data.commit_message,
      updateId: data.update_id,
      updateGroupId: data.update_group_id,
    };
  }

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
    const { error } = await this.supabase.from(Tables.UPDATE_GROUPS).delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

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
      label: m.label ?? undefined,
      createdAt: m.created_at,
    }));
  }

  async addUserToGroup(updateGroupId: string, userId: string, label?: string): Promise<void> {
    const { error } = await this.supabase
      .from(Tables.UPDATE_GROUP_MEMBERS)
      .upsert(
        { update_group_id: updateGroupId, user_id: userId, label: label ?? null },
        { onConflict: 'update_group_id,user_id' }
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

      const groupIds = (memberships ?? []).map(
        (m: { update_group_id: string }) => m.update_group_id
      );
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
}
