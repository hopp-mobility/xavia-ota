# Update Groups — Design

## Goal

Replace the current "every release goes to everyone on a runtime version" distribution model with grouped releases. Each release belongs to one **update group** (e.g. `production`, `beta`, `acme-debug`). Users can be assigned to zero or more non-default groups. The manifest endpoint resolves the release a given user receives based on their group memberships.

The motivating scenarios:
- **Beta channel** — a stable subset of testers receives builds before production. Beta runs as its own track and is not interrupted by production patches.
- **Per-customer / per-user diagnostic builds** — ship instrumentation or a one-off fix to a single user without affecting anyone else.

## Non-goals

- Hiding pre-release content from determined attackers. User identity is sent as a plain header; anyone who knows or guesses a user ID can pull any group's release. This is acceptable because builds contain in-development features, not confidential code.
- App-store-compliance rollbacks. The `rollBackToEmbedded` directive in `manifest.ts` is left as-is (latent, not surfaced in the UI). It's not part of this work.
- Group-aware tracking analytics. Existing `releases_tracking` continues to work as-is.

## Data model

Two new tables, one new column.

```sql
CREATE TABLE update_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE,
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Exactly one default group must exist.
CREATE UNIQUE INDEX one_default_update_group
    ON update_groups ((is_default))
    WHERE is_default = true;

CREATE TABLE update_group_members (
    update_group_id UUID NOT NULL REFERENCES update_groups(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (update_group_id, user_id)
);

CREATE INDEX idx_update_group_members_user_id
    ON update_group_members(user_id);

ALTER TABLE releases
    ADD COLUMN update_group_id UUID REFERENCES update_groups(id);
```

**Migration:** A bootstrap migration creates a single `production` group with `is_default = true` and backfills `releases.update_group_id` to point at it for every existing row. After backfill, `update_group_id` becomes `NOT NULL`.

**Membership semantics:**
- The default group has no membership rows. Every user is implicitly in it.
- A user with no rows in `update_group_members` is in only the default group.
- `user_id` is a string, matching whatever identifier the client sends. No FK to a users table — that table lives in the primary product DB, not here.

**Cardinality:** Each release belongs to exactly one group (single FK). Re-publishing a bundle to another group is `copyFile` + new row, same as the existing rollback flow.

## Resolver

The current rule is "latest release for this runtime version." The new rule is two-step:

> 1. If the user belongs to any non-default groups, return the newest release (by `timestamp`) across those groups for this `runtime_version`.
> 2. If step 1 returns nothing — either because the user is in zero non-default groups, or none of their groups has a release for this runtime version — return the newest release in the default group.

In SQL (single CTE-based query):

```sql
WITH user_group_release AS (
  SELECT r.*
  FROM releases r
  WHERE r.runtime_version = $1
    AND r.update_group_id IN (
      SELECT update_group_id FROM update_group_members WHERE user_id = $2
    )
  ORDER BY r.timestamp DESC
  LIMIT 1
),
default_release AS (
  SELECT r.*
  FROM releases r
  JOIN update_groups g ON r.update_group_id = g.id
  WHERE r.runtime_version = $1
    AND g.is_default = true
  ORDER BY r.timestamp DESC
  LIMIT 1
)
SELECT * FROM user_group_release
UNION ALL
SELECT * FROM default_release WHERE NOT EXISTS (SELECT 1 FROM user_group_release)
LIMIT 1;
```

**Why "non-default always wins" instead of "newest timestamp wins":** The naive timestamp rule causes silent regressions. A beta tester running release `B` (containing weeks of unreleased features) would be yanked back to production the moment any prod patch ships with a newer timestamp, since prod-patch's timestamp would beat `B`'s. The two-step rule keeps beta testers on beta unless beta has nothing for their runtime version.

**Trade-off:** Beta does not automatically inherit production patches. If prod ships a fix that should also be in beta, the operator must publish a beta release that contains the fix. See "Operational guidance" below.

**No user ID supplied:** If the request omits the user ID header, step 1 returns nothing and the resolver falls through to the default group. Same behavior as a user in zero non-default groups. This preserves backward compatibility for older app builds that pre-date this feature.

## Client identification

The mobile app sends a header on each manifest poll:

```
xavia-user-id: <opaque user id from primary product DB>
```

The server reads it as a string and passes it to the resolver. No verification, no signing. If the header is absent or empty, the resolver behaves as described above (default group only).

This is the explicit security trade-off: low-stakes preview content makes verification unnecessary. If that ever changes, the upgrade path is to add token-based auth without changing the data model.

## Manifest endpoint changes

In `pages/api/manifest.ts`:

1. Read `xavia-user-id` from request headers (treat missing/empty as anonymous).
2. Replace the call to `database.getLatestReleaseRecordForRuntimeVersion(runtimeVersion)` with a new resolver method `database.getLatestReleaseForUser(runtimeVersion, userId)` that runs the query above.
3. Replace the call to `UpdateHelper.getLatestUpdateBundlePathForRuntimeVersionAsync` similarly — it must consult the resolver, not just the runtime version.
4. The "already running this update" short-circuit at line 68 continues to work, but it now compares against the *resolved* release for the user, not the global latest. This avoids false "you already have it" responses when a user is moved between groups.

The rest of the endpoint (manifest construction, signing, multipart response, tracking insert) is unchanged.

## Database interface changes

`apiUtils/database/DatabaseInterface.ts` gains methods:

- `getLatestReleaseForUser(runtimeVersion: string, userId: string | null)` — returns the resolved release record, or `null`.
- `listUpdateGroups()` / `getUpdateGroup(id)` / `createUpdateGroup(name)` / `deleteUpdateGroup(id)` — for dashboard CRUD.
- `addUserToGroup(groupId, userId)` / `removeUserFromGroup(groupId, userId)` / `listGroupMembers(groupId)` / `listGroupsForUser(userId)`.
- `getUpdateGroupByName(name)` — used by the upload and rollback handlers to resolve the name in the request to an id.
- `createRelease` gains an optional `updateGroupId` parameter; defaults to the default group's id when omitted.

The Supabase implementation mirrors the Postgres one, using the equivalent Supabase queries. The local-storage / no-DB code path is out of scope for groups — those installations effectively have only the default group.

## Upload, releases list, rollback

- **Upload (`pages/api/upload.ts`):** Accept an optional `updateGroup` form field containing the group **name** (not ID). Names are easier to remember when uploading from a CI script or CLI. The handler resolves name → id; if no row matches, the request is rejected with 400. If absent, default to the default group.
- **Releases list (`pages/api/releases.ts`):** Return `update_group_id` and group name alongside each release. The dashboard can filter by group.
- **Rollback (`pages/api/rollback.ts`):** Inherit the source release's group for the new copy. An optional `updateGroup` field (name, same convention as upload) overrides this.

## Dashboard UI

Two new screens:

- **Groups list / detail** — create groups, view members, add/remove members by user ID. The default group is read-only (cannot be renamed or deleted; default flag cannot be moved).
- **Releases list filter** — group selector at the top of the existing releases page; release cards show their group as a badge.

Upload form gets a group selector defaulting to the default group.

## Edge cases and how they resolve

| Case | Behavior |
|---|---|
| User in only default group | Always gets latest default release. |
| User in `beta`, beta has a release for this runtime version | Gets latest beta release, regardless of prod's timestamp. |
| User in `beta`, prod ships a patch newer than the latest beta | Stays on beta. Prod patch is not visible to beta users until a beta release is published containing it. |
| User in `beta`, beta has no release for this runtime version | Falls through to latest prod. (Safety net, e.g. when bumping runtime version.) |
| User in `beta` + `acme-debug` | Newest release across the two non-default groups wins (timestamp tie-break). |
| User in diagnostic group, prod ships fixes | User stays on diagnostic until operator removes them from the group. Cleanup is explicit, not automatic. |
| User removed from `beta` | Next manifest poll resolves against default group only — they will not be served any further beta releases. They download whatever prod's latest is, even if older by timestamp than their currently-running beta build, because the bundle's update_id differs. |
| Group deleted while it owns a release | Rejected. The FK from `releases.update_group_id` uses default `NO ACTION`, so deleting a group with releases fails. Operator must move or delete the releases first. Member rows cascade-delete and don't block deletion. |
| Manifest request with no user ID header | Treated as anonymous → default group only. |
| Two clients on the same `user_id` (multiple devices) | Both get the same resolved release, which is the desired behavior. |

## Operational guidance

**Keeping beta ahead of prod.** Because non-default groups always win, beta users will not pick up prod patches automatically. Whenever a fix lands in prod that should also be in beta, the operator must publish a beta release that contains it. The recommended cadence: every prod release is accompanied by (or quickly followed by) a beta release built from a branch that has the prod commit merged in. Without this discipline, beta drifts behind prod over time.

**Forcing a user off a special build.** To move a user off a diagnostic or beta release:

- **Remove the user from the group.** Their next manifest poll falls through to the default group, and they download the latest prod release on the next poll.
- **Delete the group entirely** (after first reassigning or deleting its releases). All members fall through to prod.
- **Embedded rollback.** Available in the protocol but not surfaced in the UI; out of scope for this work.

These are documented operator workflows, not new features.

## Testing

- Unit tests for the resolver query covering:
  - Anonymous user (no header) → latest default release.
  - User with no group memberships → latest default release.
  - User in `beta`, beta has a release for the runtime version (older than prod's latest) → beta release. Confirms non-default wins regardless of prod timestamp.
  - User in `beta`, beta has no release for the runtime version → falls through to latest default release.
  - User in two non-default groups → newest by timestamp across the two.
  - Runtime version with no releases at all → returns null; manifest endpoint emits no-update directive.
- Integration test for `manifest.ts` exercising user-id header presence and absence, and confirming the resolved release is the one served.
- Migration test confirming pre-existing releases land in the default group and `update_group_id` becomes `NOT NULL`.

## Out of scope (followups)

- Group-aware download metrics in `releases_tracking`.
- Authenticated user IDs (signed token / opaque per-user secret).
- A dedicated upload flow for the embedded-rollback marker zip.
- Many-to-many release-to-group relationships.
