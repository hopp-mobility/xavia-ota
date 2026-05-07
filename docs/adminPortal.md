# Admin Portal Documentation

The admin portal provides a web interface for managing your OTA updates. 

## Dashboard Overview

![Dashboard Overview](./images/dashboard-page.png)

The main dashboard provides:
- Total number of releases
- Total number of downloads for all platforms
- Total number of downloads by platform


## Publishing and Rolling Back Updates

![Releases Page](./images/releases-page.png)

The release page provides:
- List of all releases with metadata
- Rollback functionality to a previous release

## Update Groups

The `/update-groups` page lets operators manage release distribution. Each release belongs to one update group; the manifest endpoint resolves the release a given client receives based on the user's group memberships.

- A single group is flagged as the **default** (typically `production`). Every user implicitly belongs to it; it cannot be deleted or renamed from the UI.
- Other groups (e.g. `beta`, per-customer diagnostic groups) hold explicit memberships. Users in any non-default group receive the latest release from that group, regardless of how recently the default group has shipped. Default is the fall-through when the user's groups have no release for the runtime version, or when no user id is supplied.

### Identifying the user

Manifest requests must send the user identifier as a header:

```
xavia-user-id: <user id from your primary product database>
```

The header is treated as opaque. Missing or empty header → resolver uses the default group only.

### Uploading to a group

`POST /api/upload` accepts an optional `updateGroup` form field containing the group **name** (not id). When omitted, the release lands in the default group. Unknown group names are rejected with `400`.

### Rollback

`POST /api/rollback` accepts an optional `updateGroup` field. When omitted, the new release inherits the source release's group. When supplied, the named group overrides the inherited one.

### Operational guidance

- Beta releases do not auto-inherit production patches. When a fix lands in production that should also be in beta, publish a new beta release containing the fix.
- To move a user off a special build, remove them from the group; their next manifest poll falls through to the default group's latest release.
- A group cannot be deleted while it owns releases — reassign or delete those releases first.

