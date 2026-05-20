import { createMocks } from 'node-mocks-http';
import FormData from 'form-data';

import { UpdateHelper } from '../apiUtils/helpers/UpdateHelper';
import manifestEndpoint from '../pages/api/manifest';
import { DatabaseFactory } from '../apiUtils/database/DatabaseFactory';
import { DatabaseInterface, ManifestData, Release } from '../apiUtils/database/DatabaseInterface';

jest.mock('../apiUtils/helpers/UpdateHelper');
jest.mock('../apiUtils/database/DatabaseFactory');
jest.mock('form-data');

const ASSET_BASE_URL = 'https://cdn.test.example';

const baseManifestData: ManifestData = {
  ios: {
    expoConfig: { name: 'test-app', version: '1.2.0' },
    launchAsset: {
      filePath: 'bundle.js',
      storageKey: 'releases/release-id/ios/bundle.js',
      hash: 'launch-hash',
      key: 'launch-key',
      fileExtension: '.bundle',
      contentType: 'application/javascript',
    },
    assets: [
      {
        filePath: 'icon.png',
        storageKey: 'releases/release-id/ios/icon.png',
        hash: 'icon-hash',
        key: 'icon-key',
        fileExtension: '.png',
        contentType: 'image/png',
      },
    ],
  },
};

const baseRelease: Release = {
  id: 'release-id',
  runtimeVersion: '1.0.0',
  path: 'releases/release-id',
  timestamp: '2024-03-20T00:00:00Z',
  commitHash: 'abc123',
  commitMessage: 'Test commit',
  updateId: 'uid-1',
  updateGroupId: 'g-prod',
  manifestData: baseManifestData,
};

function mockFormDataInstance() {
  const instance = {
    append: jest.fn(),
    getBoundary: jest.fn().mockReturnValue('boundary'),
    getBuffer: jest.fn().mockReturnValue(Buffer.from('mock-form-data')),
  };
  (FormData as unknown as jest.Mock).mockImplementation(() => instance);
  return instance;
}

describe('Manifest API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ASSET_BASE_URL = ASSET_BASE_URL;
  });

  it('returns 405 for non-GET requests', async () => {
    const { req, res } = createMocks({ method: 'POST' });
    await manifestEndpoint(req, res);
    expect(res._getStatusCode()).toBe(405);
  });

  it('returns 400 for invalid platform', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      headers: { 'expo-platform': 'web', 'expo-runtime-version': '1.0.0' },
    });
    await manifestEndpoint(req, res);
    expect(res._getStatusCode()).toBe(400);
  });

  it('returns 400 for missing runtime version', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      headers: { 'expo-platform': 'ios' },
    });
    await manifestEndpoint(req, res);
    expect(res._getStatusCode()).toBe(400);
  });

  it('returns 500 when ASSET_BASE_URL is unset', async () => {
    delete process.env.ASSET_BASE_URL;
    const { req, res } = createMocks({
      method: 'GET',
      headers: {
        'expo-platform': 'ios',
        'expo-runtime-version': '1.0.0',
        'expo-protocol-version': '1',
      },
    });
    await manifestEndpoint(req, res);
    expect(res._getStatusCode()).toBe(500);
  });

  it('returns NoUpdateAvailable when client is already on the latest release', async () => {
    const database = {
      getLatestReleaseForUser: jest.fn().mockResolvedValue(baseRelease),
    } as unknown as DatabaseInterface;
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(database);
    (UpdateHelper.createNoUpdateAvailableDirectiveAsync as jest.Mock).mockResolvedValue({
      type: 'noUpdateAvailable',
    });
    mockFormDataInstance();

    const { req, res } = createMocks({
      method: 'GET',
      headers: {
        'expo-platform': 'ios',
        'expo-runtime-version': '1.0.0',
        'expo-protocol-version': '1',
        'expo-current-update-id': 'uid-1',
      },
    });
    await manifestEndpoint(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(UpdateHelper.createNoUpdateAvailableDirectiveAsync).toHaveBeenCalled();
  });

  it('serves a manifest that points asset URLs at ASSET_BASE_URL', async () => {
    const createTracking = jest.fn().mockResolvedValue(undefined);
    const database = {
      getLatestReleaseForUser: jest.fn().mockResolvedValue(baseRelease),
      createTracking,
    } as unknown as DatabaseInterface;
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(database);
    const form = mockFormDataInstance();

    const { req, res } = createMocks({
      method: 'GET',
      headers: {
        'expo-platform': 'ios',
        'expo-runtime-version': '1.0.0',
        'expo-protocol-version': '1',
        'expo-current-update-id': 'something-else',
      },
    });
    await manifestEndpoint(req, res);

    expect(res._getStatusCode()).toBe(200);
    const manifestCall = form.append.mock.calls.find((call) => call[0] === 'manifest');
    expect(manifestCall).toBeDefined();
    const manifest = JSON.parse(manifestCall![1]);
    expect(manifest.id).toBe('uid-1');
    expect(manifest.launchAsset.url).toBe(
      `${ASSET_BASE_URL}/releases/release-id/ios/bundle.js`
    );
    expect(manifest.assets).toHaveLength(1);
    expect(manifest.assets[0].url).toBe(`${ASSET_BASE_URL}/releases/release-id/ios/icon.png`);
    expect(manifest.extra.expoClient).toEqual({ name: 'test-app', version: '1.2.0' });
    expect(createTracking).toHaveBeenCalledWith(
      expect.objectContaining({ releaseId: 'release-id', platform: 'ios' })
    );
  });

  it('returns NoUpdateAvailable when no release matches the runtime version', async () => {
    const database = {
      getLatestReleaseForUser: jest.fn().mockResolvedValue(null),
    } as unknown as DatabaseInterface;
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(database);
    (UpdateHelper.createNoUpdateAvailableDirectiveAsync as jest.Mock).mockResolvedValue({
      type: 'noUpdateAvailable',
    });
    mockFormDataInstance();

    const { req, res } = createMocks({
      method: 'GET',
      headers: {
        'expo-platform': 'ios',
        'expo-runtime-version': '1.0.0',
        'expo-protocol-version': '1',
      },
    });
    await manifestEndpoint(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(UpdateHelper.createNoUpdateAvailableDirectiveAsync).toHaveBeenCalled();
  });

  it('returns NoUpdateAvailable when the release has no bundle for the requested platform', async () => {
    const iosOnly: Release = { ...baseRelease, manifestData: { ios: baseManifestData.ios } };
    const database = {
      getLatestReleaseForUser: jest.fn().mockResolvedValue(iosOnly),
    } as unknown as DatabaseInterface;
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(database);
    (UpdateHelper.createNoUpdateAvailableDirectiveAsync as jest.Mock).mockResolvedValue({
      type: 'noUpdateAvailable',
    });
    mockFormDataInstance();

    const { req, res } = createMocks({
      method: 'GET',
      headers: {
        'expo-platform': 'android',
        'expo-runtime-version': '1.0.0',
        'expo-protocol-version': '1',
      },
    });
    await manifestEndpoint(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(UpdateHelper.createNoUpdateAvailableDirectiveAsync).toHaveBeenCalled();
  });

  it('passes xavia-user-id from Expo-Extra-Params to the resolver', async () => {
    const getLatestReleaseForUser = jest.fn().mockResolvedValue(baseRelease);
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue({
      getLatestReleaseForUser,
    });

    const { req, res } = createMocks({
      method: 'GET',
      headers: {
        'expo-platform': 'ios',
        'expo-runtime-version': '1.0.0',
        'expo-protocol-version': '1',
        'expo-current-update-id': 'uid-1',
        'expo-extra-params': 'xavia-user-id="user-42"',
      },
    });
    (UpdateHelper.createNoUpdateAvailableDirectiveAsync as jest.Mock).mockResolvedValue({
      type: 'noUpdateAvailable',
    });
    mockFormDataInstance();

    await manifestEndpoint(req, res);

    expect(getLatestReleaseForUser).toHaveBeenCalledWith('1.0.0', 'user-42');
  });

  describe('downgrade protection', () => {
    function setup(release: Release = baseRelease) {
      (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue({
        getLatestReleaseForUser: jest.fn().mockResolvedValue(release),
        createTracking: jest.fn().mockResolvedValue(undefined),
      });
      (UpdateHelper.createNoUpdateAvailableDirectiveAsync as jest.Mock).mockResolvedValue({
        type: 'noUpdateAvailable',
      });
      return mockFormDataInstance();
    }

    function requestWithAppVersion(clientAppVersion: string) {
      return createMocks({
        method: 'GET',
        headers: {
          'expo-platform': 'ios',
          'expo-runtime-version': '1.0.0',
          'expo-protocol-version': '1',
          'expo-current-update-id': 'something-else',
          'expo-extra-params': `xavia-app-version="${clientAppVersion}"`,
        },
      });
    }

    it('refuses to downgrade when the client app version is newer than the release', async () => {
      setup();
      const { req, res } = requestWithAppVersion('1.3.0');
      await manifestEndpoint(req, res);

      expect(res._getStatusCode()).toBe(200);
      expect(UpdateHelper.createNoUpdateAvailableDirectiveAsync).toHaveBeenCalled();
    });

    it('serves the update when the release is newer than the client', async () => {
      const form = setup();
      const { req, res } = requestWithAppVersion('1.1.0');
      await manifestEndpoint(req, res);

      expect(res._getStatusCode()).toBe(200);
      expect(UpdateHelper.createNoUpdateAvailableDirectiveAsync).not.toHaveBeenCalled();
      const manifestCall = form.append.mock.calls.find((call) => call[0] === 'manifest');
      expect(manifestCall).toBeDefined();
    });

    it('serves the update when client and release versions are equal', async () => {
      const form = setup();
      const { req, res } = requestWithAppVersion('1.2.0');
      await manifestEndpoint(req, res);

      expect(res._getStatusCode()).toBe(200);
      expect(UpdateHelper.createNoUpdateAvailableDirectiveAsync).not.toHaveBeenCalled();
      const manifestCall = form.append.mock.calls.find((call) => call[0] === 'manifest');
      expect(manifestCall).toBeDefined();
    });

    it('fails open when the release has no version in its expoConfig', async () => {
      const releaseWithoutVersion: Release = {
        ...baseRelease,
        manifestData: {
          ios: { ...baseManifestData.ios!, expoConfig: { name: 'test-app' } },
        },
      };
      const form = setup(releaseWithoutVersion);
      const { req, res } = requestWithAppVersion('1.3.0');
      await manifestEndpoint(req, res);

      expect(res._getStatusCode()).toBe(200);
      expect(UpdateHelper.createNoUpdateAvailableDirectiveAsync).not.toHaveBeenCalled();
      const manifestCall = form.append.mock.calls.find((call) => call[0] === 'manifest');
      expect(manifestCall).toBeDefined();
    });

    it('fails open when the client app version is unparseable', async () => {
      const form = setup();
      const { req, res } = requestWithAppVersion('not-a-version');
      await manifestEndpoint(req, res);

      expect(res._getStatusCode()).toBe(200);
      expect(UpdateHelper.createNoUpdateAvailableDirectiveAsync).not.toHaveBeenCalled();
      const manifestCall = form.append.mock.calls.find((call) => call[0] === 'manifest');
      expect(manifestCall).toBeDefined();
    });

    it('serves the update when the client does not send xavia-app-version', async () => {
      const form = setup();
      const { req, res } = createMocks({
        method: 'GET',
        headers: {
          'expo-platform': 'ios',
          'expo-runtime-version': '1.0.0',
          'expo-protocol-version': '1',
          'expo-current-update-id': 'something-else',
        },
      });
      await manifestEndpoint(req, res);

      expect(res._getStatusCode()).toBe(200);
      expect(UpdateHelper.createNoUpdateAvailableDirectiveAsync).not.toHaveBeenCalled();
      const manifestCall = form.append.mock.calls.find((call) => call[0] === 'manifest');
      expect(manifestCall).toBeDefined();
    });
  });

  it('treats unknown / malformed / missing Extra-Params as anonymous', async () => {
    const getLatestReleaseForUser = jest.fn().mockResolvedValue(null);
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue({ getLatestReleaseForUser });
    (UpdateHelper.createNoUpdateAvailableDirectiveAsync as jest.Mock).mockResolvedValue({
      type: 'noUpdateAvailable',
    });
    mockFormDataInstance();

    for (const header of [
      'some-other-key="x", another="y"',
      'this is not a valid dictionary!!!',
      undefined,
    ]) {
      getLatestReleaseForUser.mockClear();
      const { req, res } = createMocks({
        method: 'GET',
        headers: {
          'expo-platform': 'ios',
          'expo-runtime-version': '1.0.0',
          'expo-protocol-version': '1',
          ...(header ? { 'expo-extra-params': header } : {}),
        },
      });
      await manifestEndpoint(req, res);
      expect(getLatestReleaseForUser).toHaveBeenCalledWith('1.0.0', null);
    }
  });
});
