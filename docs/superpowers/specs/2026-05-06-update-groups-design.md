# Update Groups — Design

## Goal

Replace the current "every release goes to everyone on a runtime version" distribution model with grouped releases. Each release belongs to one **update group** (e.g. `production`, `beta`, `acme-debug`). Users can be assigned to zero or more non-default groups. The manifest endpoint resolves the release a given user receives based on their group memberships.

The motivating scenarios:
- **Beta channel** — a stable subset of testers receives builds before production.
- **Per-customer / per-user diagnostic builds** — ship instrumentation or a one-off fix to a single user without affecting anyone else.
- **Automatic cleanup** — when production catches up, special-purpose groups become irrelevant without manual intervention.

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

The current rule is "latest release for this runtime version." The new rule is:

> Newest release (by `timestamp`) for this `runtime_version`, where `update_group_id` is either the default group or a group the requesting user belongs to.

In SQL:

```sql
SELECT r.*
FROM releases r
WHERE r.runtime_version = $1
  AND r.update_group_id IN (
    SELECT id FROM update_groups WHERE is_default = true
    UNION
    SELECT update_group_id FROM update_group_members WHERE user_id = $2
  )
ORDER BY r.timestamp DESC
LIMIT 1;
```

This single query produces the desired fall-through behavior:
- A diagnostic build issued to one user is served to that user until production publishes something newer, at which point production wins automatically.
- Beta testers get beta when beta is newer than prod, prod otherwise.
- A user in zero non-default groups always receives the latest production release.

**No user ID supplied:** If the request omits the user ID header, the resolver uses only the default group. Same behavior as a user in zero groups. This preserves backward compatibility for older app builds that pre-date this feature.

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
| User in `beta`, beta newer than prod | Gets beta. |
| User in `beta`, prod ships something newer | Gets prod on next poll. Beta release becomes irrelevant. |
| Diagnostic group with one user, you forget to clean it up | Self-heals on next prod release. Group can be deleted at any time after that. |
| User removed from `beta` | Next manifest poll resolves against default group only — they will not be served any further beta releases. However, if they already downloaded a beta release, their app keeps running it until a newer release reachable to them (a new prod release, or a prod re-publish that bumps the timestamp) is available. Removal does not retroactively claw back a downloaded bundle. |
| Group deleted while user is on one of its releases | `releases.update_group_id` would dangle. Solution: deleting a group requires the operator to first move or delete its releases. Enforced at the DB level via no `ON DELETE` cascade on the FK from `releases`. |
| Manifest request with no user ID header | Treated as anonymous → default group only. |
| Two clients on the same `user_id` (multiple devices) | Both get the same resolved release, which is the desired behavior. |

## Operational levers (the "force a user back to production" question)

The fall-through behavior handles cleanup automatically once production catches up. For situations where you need a user off a special build *immediately*:

- **Re-publish the latest production release.** Bumps its timestamp past the special build. Cheapest option, no schema involved.
- **Move the user out of the special group AND re-publish prod.** Same as above plus closes the door on subsequent special releases.
- **Embedded rollback.** Out of scope for this work but available in the protocol if ever needed.

These are documented operator workflows, not new features.

## Testing

- Unit tests for the resolver query covering: anonymous user, user in default only, user in beta with beta newer, user in beta with prod newer, user in two non-default groups, runtime version with no releases, runtime version with releases only in groups the user can't access (anonymous user → default still wins; user with no access → no release returned, manifest endpoint returns no-update directive).
- Integration test for `manifest.ts` exercising header presence and absence.
- Migration test confirming pre-existing releases land in the default group.

## Out of scope (followups)

- Group-aware download metrics in `releases_tracking`.
- Authenticated user IDs (signed token / opaque per-user secret).
- A dedicated upload flow for the embedded-rollback marker zip.
- Many-to-many release-to-group relationships.
