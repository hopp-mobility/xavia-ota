import AdmZip from 'adm-zip';
import { createMocks } from 'node-mocks-http';
import FormData from 'form-data';

import { ConfigHelper } from '../apiUtils/helpers/ConfigHelper';
import { UpdateHelper } from '../apiUtils/helpers/UpdateHelper';
import { ZipHelper } from '../apiUtils/helpers/ZipHelper';
import { HashHelper } from '../apiUtils/helpers/HashHelper';
import manifestEndpoint from '../pages/api/manifest';
import { DatabaseFactory } from '../apiUtils/database/DatabaseFactory';
import { DatabaseInterface, Release } from '../apiUtils/database/DatabaseInterface';

jest.mock('../apiUtils/helpers/UpdateHelper');
jest.mock('../apiUtils/helpers/ZipHelper');
jest.mock('../apiUtils/helpers/ConfigHelper');
jest.mock('../apiUtils/helpers/HashHelper');
jest.mock('../apiUtils/database/DatabaseFactory');
jest.mock('form-data');

describe('Manifest API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 405 for non-GET requests', async () => {
    const { req, res } = createMocks({ method: 'POST' });
    await manifestEndpoint(req, res);
    expect(res._getStatusCode()).toBe(405);
    expect(JSON.parse(res._getData())).toMatchSnapshot();
  });

  it('should return 400 for invalid platform', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      headers: {
        'expo-platform': 'web',
        'expo-runtime-version': '1.0.0',
      },
    });
    await manifestEndpoint(req, res);
    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toMatchSnapshot();
  });

  it('should return 400 for missing runtime version', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      headers: {
        'expo-platform': 'ios',
      },
    });
    await manifestEndpoint(req, res);
    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toMatchSnapshot();
  });

  it('should return NoUpdateAvailable when user is already running the latest release', async () => {
    const mockRelease: Release = {
      id: 'release-id',
      runtimeVersion: '1.0.0',
      path: 'path/to/update.zip',
      timestamp: '2024-03-20T00:00:00Z',
      commitHash: 'abc123',
      commitMessage: 'Test commit',
      updateId: 'test-update-id',
      updateGroupId: 'g-prod',
    };

    const mockDatabase = {
      getLatestReleaseForUser: jest.fn().mockResolvedValue(mockRelease),
    } as unknown as DatabaseInterface;

    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(mockDatabase);

    const mockNoUpdateDirective = { type: 'noUpdateAvailable' };
    (UpdateHelper.createNoUpdateAvailableDirectiveAsync as jest.Mock).mockResolvedValue(
      mockNoUpdateDirective
    );

    const mockFormData = {
      append: jest.fn(),
      getBoundary: jest.fn().mockReturnValue('boundary'),
      getBuffer: jest.fn().mockReturnValue(Buffer.from('mock-form-data')),
    };
    (FormData as unknown as jest.Mock).mockImplementation(() => mockFormData);

    const { req, res } = createMocks({
      method: 'GET',
      headers: {
        'expo-platform': 'ios',
        'expo-runtime-version': '1.0.0',
        'expo-protocol-version': '1',
        'expo-current-update-id': 'test-update-id', // Same as the release updateId
      },
    });

    await manifestEndpoint(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(UpdateHelper.createNoUpdateAvailableDirectiveAsync).toHaveBeenCalled();
    expect(mockFormData.append).toHaveBeenCalledWith(
      'directive',
      JSON.stringify(mockNoUpdateDirective),
      expect.any(Object)
    );
  });

  it('should handle normal update successfully and pass releaseId to asset metadata', async () => {
    const mockRelease: Release = {
      id: 'release-id-42',
      runtimeVersion: '1.0.0',
      path: 'path/to/update.zip',
      timestamp: '2024-03-20T00:00:00Z',
      commitHash: 'abc123',
      commitMessage: 'Test commit',
      updateId: 'different-update-id',
      updateGroupId: 'g-prod',
    };

    const mockDatabase = {
      getLatestReleaseForUser: jest.fn().mockResolvedValue(mockRelease),
      createTracking: jest.fn().mockResolvedValue(undefined),
    } as unknown as DatabaseInterface;

    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(mockDatabase);

    const mockMetadata = {
      metadataJson: {
        fileMetadata: {
          ios: {
            assets: [{ path: 'test.png', ext: '.png' }],
            bundle: 'bundle.js',
          },
        },
      },
      createdAt: '2024-03-20T00:00:00Z',
      id: 'test-id',
    };

    const mockUUID = 'test-uuid';
    (HashHelper.convertSHA256HashToUUID as jest.Mock).mockReturnValue(mockUUID);

    (UpdateHelper.getMetadataAsync as jest.Mock).mockResolvedValue(mockMetadata);
    (UpdateHelper.getAssetMetadataAsync as jest.Mock).mockResolvedValue({
      hash: 'hash',
      key: 'key',
      fileExtension: '.ext',
      contentType: 'contentType',
      url: 'url',
    });

    (ConfigHelper.getExpoConfigAsync as jest.Mock).mockResolvedValue({});

    const mockZip = {
      getEntry: jest.fn().mockReturnValue(null),
    };
    (ZipHelper.getZipFromStorage as jest.Mock).mockResolvedValue(mockZip as unknown as AdmZip);

    const mockFormData = {
      append: jest.fn(),
      getBoundary: jest.fn().mockReturnValue('boundary'),
      getBuffer: jest.fn().mockReturnValue(Buffer.from('mock-form-data')),
    };
    (FormData as unknown as jest.Mock).mockImplementation(() => mockFormData);

    const { req, res } = createMocks({
      method: 'GET',
      headers: {
        'expo-platform': 'ios',
        'expo-runtime-version': '1.0.0',
        'expo-protocol-version': '1',
        'expo-current-update-id': 'current-update-id',
      },
    });

    await manifestEndpoint(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(mockDatabase.createTracking).toHaveBeenCalledWith(
      expect.objectContaining({ releaseId: 'release-id-42', platform: 'ios' })
    );
    expect(UpdateHelper.getAssetMetadataAsync).toHaveBeenCalledWith(
      expect.objectContaining({ releaseId: 'release-id-42', updateBundlePath: 'path/to/update' })
    );
    expect(mockFormData.append).toHaveBeenCalledWith(
      'manifest',
      expect.any(String),
      expect.any(Object)
    );
  });

  it('should handle rollback update successfully', async () => {
    const mockRelease: Release = {
      id: 'release-id',
      runtimeVersion: '1.0.0',
      path: 'path/to/update.zip',
      timestamp: '2024-03-20T00:00:00Z',
      commitHash: 'abc',
      commitMessage: 'msg',
      updateId: 'uid-1',
      updateGroupId: 'g-prod',
    };
    const mockDatabase = {
      getLatestReleaseForUser: jest.fn().mockResolvedValue(mockRelease),
    } as unknown as DatabaseInterface;

    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(mockDatabase);

    (UpdateHelper.createRollBackDirectiveAsync as jest.Mock).mockResolvedValue({
      type: 'rollBackToEmbedded',
      parameters: {
        commitTime: '2024-03-20T00:00:00Z',
      },
    });

    const mockZip = {
      getEntry: jest.fn().mockReturnValue({ name: 'rollback' }),
    };
    (ZipHelper.getZipFromStorage as jest.Mock).mockResolvedValue(mockZip as unknown as AdmZip);

    const mockFormData = {
      append: jest.fn(),
      getBoundary: jest.fn().mockReturnValue('boundary'),
      getBuffer: jest.fn().mockReturnValue(Buffer.from('mock-form-data')),
    };
    (FormData as unknown as jest.Mock).mockImplementation(() => mockFormData);

    const { req, res } = createMocks({
      method: 'GET',
      headers: {
        'expo-platform': 'ios',
        'expo-runtime-version': '1.0.0',
        'expo-protocol-version': '1',
        'expo-current-update-id': 'current-id',
        'expo-embedded-update-id': 'embedded-id',
      },
    });

    await manifestEndpoint(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(UpdateHelper.createRollBackDirectiveAsync).toHaveBeenCalled();
    expect(mockFormData.append).toHaveBeenCalledWith(
      'directive',
      expect.any(String),
      expect.any(Object)
    );
  });

  it('should return NoUpdateAvailable when current update matches latest', async () => {
    const mockRelease: Release = {
      id: 'release-id',
      runtimeVersion: '1.0.0',
      path: 'path/to/update.zip',
      timestamp: '2024-03-20T00:00:00Z',
      commitHash: 'abc',
      commitMessage: 'msg',
      updateId: 'uid-stored',
      updateGroupId: 'g-prod',
    };
    const mockDatabase = {
      getLatestReleaseForUser: jest.fn().mockResolvedValue(mockRelease),
    } as unknown as DatabaseInterface;

    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(mockDatabase);

    const mockMetadata = {
      metadataJson: { fileMetadata: { ios: {} } },
      createdAt: '2024-03-20T00:00:00Z',
      id: 'test-id',
    };
    (UpdateHelper.getMetadataAsync as jest.Mock).mockResolvedValue(mockMetadata);

    // Hash matches the request's expo-current-update-id → fall into NoUpdateAvailable
    (HashHelper.convertSHA256HashToUUID as jest.Mock).mockReturnValue('current-update-id');

    const mockNoUpdateDirective = { type: 'noUpdateAvailable' };
    (UpdateHelper.createNoUpdateAvailableDirectiveAsync as jest.Mock).mockResolvedValue(
      mockNoUpdateDirective
    );

    const mockZip = {
      getEntry: jest.fn().mockReturnValue(null),
    };
    (ZipHelper.getZipFromStorage as jest.Mock).mockResolvedValue(mockZip as unknown as AdmZip);

    const mockFormData = {
      append: jest.fn(),
      getBoundary: jest.fn().mockReturnValue('boundary'),
      getBuffer: jest.fn().mockReturnValue(Buffer.from('mock-form-data')),
    };
    (FormData as unknown as jest.Mock).mockImplementation(() => mockFormData);

    const { req, res } = createMocks({
      method: 'GET',
      headers: {
        'expo-platform': 'ios',
        'expo-runtime-version': '1.0.0',
        'expo-protocol-version': '1',
        'expo-current-update-id': 'current-update-id',
      },
    });

    await manifestEndpoint(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(UpdateHelper.createNoUpdateAvailableDirectiveAsync).toHaveBeenCalled();
  });

  it('should return NoUpdateAvailable when resolver finds no release for the runtime version', async () => {
    const mockDatabase = {
      getLatestReleaseForUser: jest.fn().mockResolvedValue(null),
    } as unknown as DatabaseInterface;

    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(mockDatabase);

    const mockNoUpdateDirective = { type: 'noUpdateAvailable' };
    (UpdateHelper.createNoUpdateAvailableDirectiveAsync as jest.Mock).mockResolvedValue(
      mockNoUpdateDirective
    );

    const mockFormData = {
      append: jest.fn(),
      getBoundary: jest.fn().mockReturnValue('boundary'),
      getBuffer: jest.fn().mockReturnValue(Buffer.from('mock-form-data')),
    };
    (FormData as unknown as jest.Mock).mockImplementation(() => mockFormData);

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

  it('passes xavia-user-id (from Expo-Extra-Params) to the resolver', async () => {
    const mockRelease: Release = {
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

    await manifestEndpoint(req, res);

    expect(getLatestReleaseForUser).toHaveBeenCalledWith('1.0.0', 'user-42');
  });

  it('ignores unknown Expo-Extra-Params keys', async () => {
    const getLatestReleaseForUser = jest.fn().mockResolvedValue(null);
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue({ getLatestReleaseForUser });

    const { req, res } = createMocks({
      method: 'GET',
      headers: {
        'expo-platform': 'ios',
        'expo-runtime-version': '1.0.0',
        'expo-protocol-version': '1',
        'expo-extra-params': 'some-other-key="x", another="y"',
      },
    });

    await manifestEndpoint(req, res);

    expect(getLatestReleaseForUser).toHaveBeenCalledWith('1.0.0', null);
  });

  it('treats malformed Expo-Extra-Params as anonymous', async () => {
    const getLatestReleaseForUser = jest.fn().mockResolvedValue(null);
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue({ getLatestReleaseForUser });

    const { req, res } = createMocks({
      method: 'GET',
      headers: {
        'expo-platform': 'ios',
        'expo-runtime-version': '1.0.0',
        'expo-protocol-version': '1',
        'expo-extra-params': 'this is not a valid dictionary!!!',
      },
    });

    await manifestEndpoint(req, res);

    expect(getLatestReleaseForUser).toHaveBeenCalledWith('1.0.0', null);
  });

  it('treats missing Expo-Extra-Params as anonymous (null userId)', async () => {
    const getLatestReleaseForUser = jest.fn().mockResolvedValue(null);
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue({
      getLatestReleaseForUser,
    });

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
});

