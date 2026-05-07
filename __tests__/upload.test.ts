import formidable from 'formidable';
import { createMocks } from 'node-mocks-http';
import fs from 'fs';
import AdmZip from 'adm-zip';

import { DatabaseFactory } from '../apiUtils/database/DatabaseFactory';
import { StorageFactory } from '../apiUtils/storage/StorageFactory';
import { ZipHelper } from '../apiUtils/helpers/ZipHelper';
import { HashHelper } from '../apiUtils/helpers/HashHelper';
import uploadHandler from '../pages/api/upload';

jest.mock('../apiUtils/database/DatabaseFactory');
jest.mock('../apiUtils/storage/StorageFactory');
jest.mock('../apiUtils/helpers/ZipHelper');
jest.mock('../apiUtils/helpers/HashHelper');
jest.mock('formidable');
jest.mock('adm-zip');

describe('Upload API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 405 for non-POST requests', async () => {
    const { req, res } = createMocks({ method: 'GET' });
    await uploadHandler(req, res);
    expect(res._getStatusCode()).toBe(405);
    expect(JSON.parse(res._getData())).toMatchSnapshot();
  });

  it('should handle file upload successfully', async () => {
    // Mock form data
    const mockForm = {
      parse: jest.fn().mockResolvedValue([
        {
          uploadKey: [process.env.UPLOAD_KEY],
          runtimeVersion: ['1.0.0'],
          commitHash: ['abc123'],
          commitMessage: ['Test commit message'],
        },
        {
          file: [{ filepath: 'test.zip' }],
        },
      ]),
    };
    (formidable as unknown as jest.Mock).mockReturnValue(mockForm);

    // Mock file system
    const mockFileContent = Buffer.from('test file content');
    jest.spyOn(fs, 'readFileSync').mockReturnValue(mockFileContent);

    // Mock AdmZip
    const mockZipFolder = {} as AdmZip;
    (AdmZip as unknown as jest.Mock).mockImplementation(() => mockZipFolder);

    // Mock ZipHelper
    const mockMetadataContent = Buffer.from('{"version":"1.0.0"}');
    (ZipHelper.getFileFromZip as jest.Mock).mockResolvedValue(mockMetadataContent);

    // Mock HashHelper
    const mockHash = 'abcdef1234567890abcdef1234567890';
    const mockUpdateId = 'abcdef12-3456-7890-abcd-ef1234567890';
    (HashHelper.createHash as jest.Mock).mockReturnValue(mockHash);
    (HashHelper.convertSHA256HashToUUID as jest.Mock).mockReturnValue(mockUpdateId);

    // Mock storage and database
    const mockStorage = {
      uploadFile: jest.fn().mockResolvedValue('updates/1.0.0/timestamp.zip'),
    };
    const mockDatabase = {
      getDefaultUpdateGroup: jest.fn().mockResolvedValue({
        id: 'g-prod',
        name: 'production',
        isDefault: true,
        createdAt: 't',
      }),
      createRelease: jest.fn().mockResolvedValue(true),
    };
    (StorageFactory.getStorage as jest.Mock).mockReturnValue(mockStorage);
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(mockDatabase);

    // Execute test
    const { req, res } = createMocks({ method: 'POST' });
    await uploadHandler(req, res);

    // Verify results
    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toMatchSnapshot();

    // Verify all mocks were called correctly
    expect(mockStorage.uploadFile).toHaveBeenCalled();
    expect(mockDatabase.createRelease).toHaveBeenCalledWith(expect.objectContaining({
      path: 'updates/1.0.0/timestamp.zip',
      runtimeVersion: '1.0.0',
      timestamp: expect.any(String),
      commitHash: 'abc123',
      commitMessage: 'Test commit message',
      updateId: mockUpdateId,
      updateGroupId: 'g-prod',
    }));
    expect(ZipHelper.getFileFromZip).toHaveBeenCalledWith(mockZipFolder, 'metadata.json');
    expect(HashHelper.createHash).toHaveBeenCalledWith(mockMetadataContent, 'sha256', 'hex');
    expect(HashHelper.convertSHA256HashToUUID).toHaveBeenCalledWith(mockHash);
  });

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

  it('should return 400 for missing required fields', async () => {
    const mockForm = {
      parse: jest.fn().mockResolvedValue([{}, {}]),
    };

    (formidable as unknown as jest.Mock).mockReturnValue(mockForm);

    const { req, res } = createMocks({ method: 'POST' });
    await uploadHandler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toMatchSnapshot();
  });
});
