import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RustfsService } from './rustfs.service';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';

jest.mock('@aws-sdk/client-s3');

describe('RustfsService', () => {
  let service: RustfsService;
  let configService: jest.Mocked<Record<string, jest.Mock>>;

  beforeEach(async () => {
    configService = {
      get: jest.fn().mockImplementation((key: string, defaultValue?: any) => {
        const values: Record<string, any> = {
          RUSTFS_ENDPOINT: 'http://localhost:9004',
          RUSTFS_ACCESS_KEY: 'test-key',
          RUSTFS_SECRET_KEY: 'test-secret',
          RUSTFS_REGION: 'us-east-1',
          RUSTFS_BUCKET: 'documents',
        };
        return values[key] ?? defaultValue;
      }),
    };

    const mockSend = jest.fn();

    (S3Client as jest.Mock).mockImplementation(() => ({
      send: mockSend,
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RustfsService,
        {
          provide: ConfigService,
          useValue: configService,
        },
      ],
    }).compile();

    service = module.get<RustfsService>(RustfsService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getBucket', () => {
    it('should return configured bucket name', () => {
      const result = service.getBucket();

      expect(result).toBe('documents');
    });
  });

  describe('getFileUrl', () => {
    it('should generate correct file URL', () => {
      const url = service.getFileUrl('test-doc/test.pdf');

      expect(url).toBe('http://localhost:9004/documents/test-doc/test.pdf');
    });

    it('should handle nested paths', () => {
      const url = service.getFileUrl('folder/subfolder/file.txt');

      expect(url).toBe('http://localhost:9004/documents/folder/subfolder/file.txt');
    });

    it('should encode non-ASCII path segments in generated URLs', () => {
      const url = service.getFileUrl('test-doc/测试文档.md');

      expect(url).toBe('http://localhost:9004/documents/test-doc/%E6%B5%8B%E8%AF%95%E6%96%87%E6%A1%A3.md');
    });
  });

  describe('uploadFile', () => {
    it('should upload file successfully', async () => {
      const mockSend = jest.fn().mockResolvedValue({});
      (S3Client as jest.Mock).mockImplementation(() => ({ send: mockSend }));

      const service = new RustfsService(configService);
      const fileBuffer = Buffer.from('test content');

      const result = await service.uploadFile('test-doc/test.pdf', fileBuffer, 'application/pdf');

      expect(result).toBe('http://localhost:9004/documents/test-doc/test.pdf');
      expect(mockSend).toHaveBeenCalledWith(expect.any(PutObjectCommand));
    });

    it('should store Chinese file names as raw object keys and return encoded URLs', async () => {
      const mockSend = jest.fn().mockResolvedValue({});
      (S3Client as jest.Mock).mockImplementation(() => ({ send: mockSend }));

      const service = new RustfsService(configService);
      const fileBuffer = Buffer.from('test content');

      const result = await service.uploadFile('test-doc/测试文档.md', fileBuffer, 'text/markdown');

      expect(result).toBe('http://localhost:9004/documents/test-doc/%E6%B5%8B%E8%AF%95%E6%96%87%E6%A1%A3.md');
      expect(PutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: 'documents',
          Key: 'test-doc/测试文档.md',
          Body: fileBuffer,
          ContentType: 'text/markdown',
        }),
      );
    });

    it('should throw error if upload fails', async () => {
      const mockSend = jest.fn().mockRejectedValue(new Error('Upload failed'));
      (S3Client as jest.Mock).mockImplementation(() => ({ send: mockSend }));

      const service = new RustfsService(configService);
      const fileBuffer = Buffer.from('test content');

      await expect(service.uploadFile('test-doc/test.pdf', fileBuffer)).rejects.toThrow(/Upload failed/);
    });

    it('should handle upload without contentType', async () => {
      const mockSend = jest.fn().mockResolvedValue({});
      (S3Client as jest.Mock).mockImplementation(() => ({ send: mockSend }));

      const service = new RustfsService(configService);
      const fileBuffer = Buffer.from('test content');

      await service.uploadFile('test-doc/test.txt', fileBuffer);

      expect(mockSend).toHaveBeenCalledWith(expect.any(PutObjectCommand));
    });
  });

  describe('downloadFile', () => {
    it('should download file successfully', async () => {
      const mockStream = new Readable();
      mockStream.push(Buffer.from('test content'));
      mockStream.push(null);
      const mockSend = jest.fn().mockResolvedValue({ Body: mockStream });
      (S3Client as jest.Mock).mockImplementation(() => ({ send: mockSend }));

      const service = new RustfsService(configService);

      const result = await service.downloadFile('test-doc/test.pdf');

      expect(result).toBeInstanceOf(Buffer);
      expect(result.toString()).toBe('test content');
      expect(mockSend).toHaveBeenCalledWith(expect.any(GetObjectCommand));
    });

    it('should throw error if download fails', async () => {
      const mockSend = jest.fn().mockRejectedValue(new Error('Download failed'));
      (S3Client as jest.Mock).mockImplementation(() => ({ send: mockSend }));

      const service = new RustfsService(configService);

      await expect(service.downloadFile('test-doc/test.pdf')).rejects.toThrow(/Download failed/);
    });

    it('should fall back to legacy encoded object keys when raw key is missing', async () => {
      const mockStream = new Readable();
      mockStream.push(Buffer.from('test content'));
      mockStream.push(null);
      const mockSend = jest.fn().mockResolvedValue({ Buckets: [{ Name: 'documents' }] });
      (S3Client as jest.Mock).mockImplementation(() => ({ send: mockSend }));

      const service = new RustfsService(configService);
      const notFoundError = new Error('The specified key does not exist.');
      notFoundError.name = 'NoSuchKey';

      await Promise.resolve();
      mockSend.mockReset();
      (GetObjectCommand as unknown as jest.Mock).mockClear();
      mockSend.mockRejectedValueOnce(notFoundError).mockResolvedValueOnce({ Body: mockStream });

      const result = await service.downloadFile('test-doc/测试文档.md');

      expect(result.toString()).toBe('test content');
      expect(GetObjectCommand).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ Bucket: 'documents', Key: 'test-doc/测试文档.md' }),
      );
      expect(GetObjectCommand).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          Bucket: 'documents',
          Key: 'test-doc/%E6%B5%8B%E8%AF%95%E6%96%87%E6%A1%A3.md',
        }),
      );
    });
  });

  describe('deleteFile', () => {
    it('should delete file successfully', async () => {
      const mockSend = jest.fn().mockResolvedValue({});
      (S3Client as jest.Mock).mockImplementation(() => ({ send: mockSend }));

      const service = new RustfsService(configService);

      await service.deleteFile('test-doc/test.pdf');

      expect(mockSend).toHaveBeenCalledWith(expect.any(DeleteObjectCommand));
    });

    it('should throw error if delete fails', async () => {
      const mockSend = jest.fn().mockRejectedValue(new Error('Delete failed'));
      (S3Client as jest.Mock).mockImplementation(() => ({ send: mockSend }));

      const service = new RustfsService(configService);

      await expect(service.deleteFile('test-doc/test.pdf')).rejects.toThrow(/Delete failed/);
    });
  });

  describe('fileExists', () => {
    it('should return true if file exists', async () => {
      const mockSend = jest.fn().mockResolvedValue({});
      (S3Client as jest.Mock).mockImplementation(() => ({ send: mockSend }));

      const service = new RustfsService(configService);

      const result = await service.fileExists('test-doc/test.pdf');

      expect(result).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(expect.any(HeadObjectCommand));
    });

    it('should return false if file not found', async () => {
      const mockError = new Error('NotFound');
      mockError.name = 'NotFound';
      const mockSend = jest.fn().mockRejectedValue(mockError);
      (S3Client as jest.Mock).mockImplementation(() => ({ send: mockSend }));

      const service = new RustfsService(configService);

      const result = await service.fileExists('non-existent.pdf');

      expect(result).toBe(false);
    });

    it('should throw error for other errors', async () => {
      const mockSend = jest.fn().mockRejectedValue(new Error('Internal error'));
      (S3Client as jest.Mock).mockImplementation(() => ({ send: mockSend }));

      const service = new RustfsService(configService);

      await expect(service.fileExists('test-doc/test.pdf')).rejects.toThrow('Internal error');
    });
  });
});
