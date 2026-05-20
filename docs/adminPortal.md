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

### Asset delivery

Releases are unzipped at upload time and individual asset files are stored in R2 under `releases/<releaseId>/<platform>/<original-path>`. The manifest endpoint hands clients direct R2 URLs of the form `${ASSET_BASE_URL}/<storageKey>`; assets are served straight from R2 with no round-trip through the Render web service.

**Requirements:**
- The R2 bucket must allow public read access. Enable the `r2.dev` subdomain (Cloudflare R2 → Settings → Public Access → "Allow Access") or attach a custom domain.
- Set `ASSET_BASE_URL` in the Render dashboard to that base URL (e.g. `https://pub-<hash>.r2.dev` or your CDN hostname). No trailing slash.
- Per-asset Content-Type is baked in at upload time, so R2 serves correct types without any extra config.

### Identifying the user

Manifest requests carry the user identifier inside Expo's standard `Expo-Extra-Params` header. On the client, set it once at app startup:

```ts
import * as Updates from 'expo-updates';
await Updates.setExtraParamAsync('xavia-user-id', currentUserId);
```

The Expo client serializes this as an RFC 8941 dictionary on every manifest poll, for example:

```
Expo-Extra-Params: xavia-user-id="abc123"
```

The server parses the dictionary, extracts the `xavia-user-id` value, and treats it as an opaque string. Missing key, missing header, or a malformed dictionary → the resolver falls back to the default group.

### Downgrade protection

When you use a `fingerprint` runtime version that intentionally excludes `expo.version` (so OTAs can span native builds), the server may otherwise serve an older release to a newer native binary that was never published to Xavia. To opt into protection, send the running app's version alongside the user id:

```ts
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

await Updates.setExtraParamAsync('xavia-app-version', Constants.expoConfig?.version ?? '');
```

The manifest endpoint compares `xavia-app-version` against the candidate release's `expoConfig.version` using semver. If the release is strictly older, it returns `noUpdateAvailable`. If either side is missing or unparseable, the server logs a warning and serves the update anyway (fail open) — the protection only kicks in when both sides parse cleanly.

### Uploading to a group

`POST /api/upload` accepts an optional `updateGroup` form field containing the group **name** (not id). When omitted, the release lands in the default group. Unknown group names are rejected with `400`.

### Rollback

`POST /api/rollback` accepts an optional `updateGroup` field. When omitted, the new release inherits the source release's group. When supplied, the named group overrides the inherited one.

### Operational guidance

- Beta releases do not auto-inherit production patches. When a fix lands in production that should also be in beta, publish a new beta release containing the fix.
- To move a user off a special build, remove them from the group; their next manifest poll falls through to the default group's latest release.
- A group cannot be deleted while it owns releases — reassign or delete those releases first.

