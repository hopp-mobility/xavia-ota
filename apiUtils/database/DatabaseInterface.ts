export interface AssetEntry {
  filePath: string;
  storageKey: string;
  hash: string;
  key: string;
  fileExtension: string;
  contentType: string;
}

export interface PlatformBundle {
  assets: AssetEntry[];
  launchAsset: AssetEntry;
  expoConfig: unknown;
}

export interface ManifestData {
  ios?: PlatformBundle;
  android?: PlatformBundle;
}

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
  manifestData?: ManifestData;
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
  label?: string;
  createdAt: string;
}

export interface DatabaseInterface {
  // `id` is optional — when omitted, the database default (gen_random_uuid)
  // assigns one. Pass an explicit id when callers need to reference it
  // before the row exists (e.g. to derive storage keys at upload time).
  createRelease(release: Omit<Release, 'updateGroupName'> & { id?: string }): Promise<Release>;
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
  addUserToGroup(updateGroupId: string, userId: string, label?: string): Promise<void>;
  removeUserFromGroup(updateGroupId: string, userId: string): Promise<void>;

  // Resolver
  getLatestReleaseForUser(runtimeVersion: string, userId: string | null): Promise<Release | null>;
}
