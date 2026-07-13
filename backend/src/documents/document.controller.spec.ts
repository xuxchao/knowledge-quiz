import { StreamableFile } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { ChunkService } from './chunk.service';
import { FileProcessorService } from '../infrastructure/file-processor/file-processor.service';
import { AiService } from '../ai/ai.service';
import { SpeechService } from '../infrastructure/speech/speech.service';
import { Neo4jService } from '../infrastructure/neo4j/neo4j.service';
import { RustfsService } from '../infrastructure/rustfs/rustfs.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Document, FileType, DocumentStatus } from '../entities/document.entity';
import { DocumentIngestionService } from './document-ingestion.service';
import { RedisService } from '../infrastructure/redis/redis.service';
import { ElasticsearchService } from '../infrastructure/elasticsearch/elasticsearch.service';

describe('DocumentController', () => {
  let controller: DocumentController;
  let documentService: DocumentService;
  let rustfsService: RustfsService;

  const mockRustfsService = {
    uploadFile: jest.fn().mockResolvedValue('http://localhost:9004/documents/test-uuid/test.pdf'),
    downloadFile: jest.fn().mockResolvedValue(Buffer.from('document content')),
    getBucket: jest.fn().mockReturnValue('documents'),
  };

  const mockAiService = {};
  const mockSpeechService = {};
  const mockNeo4jService = {
    deleteByDocumentId: jest.fn().mockResolvedValue(),
  };

  const mockFileProcessorService = {
    processFile: jest.fn(),
    chunkText: jest.fn(),
    splitText: jest.fn(),
    storeChunks: jest.fn(),
  };

  const mockChunkService = {
    createForDocument: jest.fn(),
  };
  const mockIngestionService = { enqueue: jest.fn().mockResolvedValue('job-1'), getStatus: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockIngestionService.enqueue.mockResolvedValue('job-1');
    mockRustfsService.uploadFile.mockResolvedValue('http://localhost:9004/documents/test-uuid/test.pdf');
    mockRustfsService.downloadFile.mockResolvedValue(Buffer.from('document content'));
    mockFileProcessorService.processFile.mockResolvedValue({
      text: 'test content',
      metadata: { numPages: 1, author: 'Test' },
    });
    mockFileProcessorService.chunkText.mockReturnValue(['chunk1', 'chunk2']);
    mockFileProcessorService.splitText.mockResolvedValue(['chunk1', 'chunk2']);
    mockFileProcessorService.storeChunks.mockResolvedValue([
      {
        content: 'chunk1',
        metadata: { documentId: 'test-uuid', chunkIndex: 0, totalChunks: 2 },
        embedding: JSON.stringify([0.1, 0.2]),
        chunkIndex: 0,
        totalChunks: 2,
      },
      {
        content: 'chunk2',
        metadata: { documentId: 'test-uuid', chunkIndex: 1, totalChunks: 2 },
        embedding: JSON.stringify([0.3, 0.4]),
        chunkIndex: 1,
        totalChunks: 2,
      },
    ]);
    mockChunkService.createForDocument.mockResolvedValue([]);
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot()],
      controllers: [DocumentController],
      providers: [
        DocumentService,
        {
          provide: ChunkService,
          useValue: mockChunkService,
        },
        {
          provide: FileProcessorService,
          useValue: mockFileProcessorService,
        },
        {
          provide: AiService,
          useValue: mockAiService,
        },
        {
          provide: SpeechService,
          useValue: mockSpeechService,
        },
        {
          provide: Neo4jService,
          useValue: mockNeo4jService,
        },
        {
          provide: RustfsService,
          useValue: mockRustfsService,
        },
        { provide: DocumentIngestionService, useValue: mockIngestionService },
        { provide: RedisService, useValue: { lpush: jest.fn().mockResolvedValue(undefined) } },
        { provide: ElasticsearchService, useValue: { deleteByDocumentId: jest.fn().mockResolvedValue(undefined) } },
        {
          provide: getRepositoryToken(Document),
          useValue: {
            create: jest.fn().mockImplementation((data) => ({ id: 'test-uuid', ...data })),
            save: jest.fn().mockResolvedValue({
              id: 'test-uuid',
              name: 'test',
              status: DocumentStatus.PROCESSING,
            }),
            findOne: jest.fn().mockResolvedValue({
              id: 'test-uuid',
              name: 'test',
              status: DocumentStatus.PROCESSED,
              chunks: [],
            }),
            find: jest.fn().mockResolvedValue([]),
            createQueryBuilder: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnThis(),
              orderBy: jest.fn().mockReturnThis(),
              skip: jest.fn().mockReturnThis(),
              take: jest.fn().mockReturnThis(),
              getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
            }),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
            delete: jest.fn().mockResolvedValue({ affected: 1 }),
          },
        },
      ],
    }).compile();

    controller = module.get<DocumentController>(DocumentController);
    documentService = module.get<DocumentService>(DocumentService);
    rustfsService = module.get<RustfsService>(RustfsService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('listDocuments', () => {
    it('should return documents list with pagination', async () => {
      const mockDocuments = [
        { id: '1', name: 'doc1' },
        { id: '2', name: 'doc2' },
      ];
      const mockCount = 10;

      jest.spyOn(documentService, 'findAll').mockResolvedValue([mockDocuments, mockCount]);

      const result = await controller.listDocuments({ name: '', page: 1, limit: 10 });

      expect(result).toEqual({
        success: true,
        data: mockDocuments,
        pagination: {
          page: 1,
          limit: 10,
          total: mockCount,
          pages: Math.ceil(mockCount / 10),
        },
      });
      expect(documentService.findAll).toHaveBeenCalledWith('', 0, 10);
    });

    it('should filter documents by name', async () => {
      jest.spyOn(documentService, 'findAll').mockResolvedValue([[], 0]);

      await controller.listDocuments({ name: 'test', page: 1, limit: 10 });

      expect(documentService.findAll).toHaveBeenCalledWith('test', 0, 10);
    });

    it('should handle page 0 by defaulting to page 1', async () => {
      jest.spyOn(documentService, 'findAll').mockResolvedValue([[], 0]);

      await controller.listDocuments({ name: '', page: 0, limit: 10 });

      expect(documentService.findAll).toHaveBeenCalledWith('', 0, 10);
    });

    it('should handle negative page by defaulting to page 1', async () => {
      jest.spyOn(documentService, 'findAll').mockResolvedValue([[], 0]);

      await controller.listDocuments({ name: '', page: -1, limit: 10 });

      expect(documentService.findAll).toHaveBeenCalledWith('', 0, 10);
    });
  });

  describe('getDocument', () => {
    it('should return document by id', async () => {
      const mockDocument = { id: '1', name: 'test', chunks: [] };

      jest.spyOn(documentService, 'findById').mockResolvedValue(mockDocument as Document);

      const result = await controller.getDocument('1');

      expect(result).toEqual({
        success: true,
        data: mockDocument,
      });
      expect(documentService.findById).toHaveBeenCalledWith('1', true);
    });

    it('should throw error if document not found', async () => {
      jest.spyOn(documentService, 'findById').mockResolvedValue(null);

      await expect(controller.getDocument('non-existent')).rejects.toThrow('Document not found');
    });

    it('should handle empty id', async () => {
      jest.spyOn(documentService, 'findById').mockResolvedValue(null);

      await expect(controller.getDocument('')).rejects.toThrow('Document not found');
    });
  });

  describe('deleteDocument', () => {
    it('should delete document successfully', async () => {
      const mockDocument = { id: '1', name: 'test', chunks: [] };

      jest.spyOn(documentService, 'findById').mockResolvedValue(mockDocument as Document);
      jest.spyOn(documentService, 'delete').mockResolvedValue();

      const result = await controller.deleteDocument('1');

      expect(result).toEqual({
        success: true,
        message: 'Document deleted successfully',
      });
      expect(documentService.findById).toHaveBeenCalledWith('1', false);
      expect(documentService.delete).toHaveBeenCalledWith('1');
    });

    it('should throw error if document not found', async () => {
      jest.spyOn(documentService, 'findById').mockResolvedValue(null);

      await expect(controller.deleteDocument('non-existent')).rejects.toThrow('Document not found');
    });

    it('should handle empty id', async () => {
      jest.spyOn(documentService, 'findById').mockResolvedValue(null);

      await expect(controller.deleteDocument('')).rejects.toThrow('Document not found');
    });
  });

  describe('downloadDocument', () => {
    it('should download the original file with its title', async () => {
      jest.spyOn(documentService, 'findById').mockResolvedValue({
        id: 'doc-1',
        name: '产品说明.pdf',
        storageKey: 'doc-1/产品说明.pdf',
      } as Document);
      const response = { set: jest.fn() };

      const result = await controller.downloadDocument('doc-1', response as never);

      expect(result).toBeInstanceOf(StreamableFile);
      expect(rustfsService.downloadFile).toHaveBeenCalledWith('doc-1/产品说明.pdf');
      expect(response.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'Content-Disposition': expect.stringContaining(encodeURIComponent('产品说明.pdf')),
        }),
      );
    });

    it('should reject documents without a stored file', async () => {
      jest.spyOn(documentService, 'findById').mockResolvedValue({ id: 'doc-1', name: '网页' } as Document);

      await expect(controller.downloadDocument('doc-1', { set: jest.fn() } as never)).rejects.toThrow(
        'Document file not found',
      );
    });
  });

  describe('uploadFile', () => {
    it('should store a file, enqueue ingestion and return a job id', async () => {
      const mockFile = {
        originalname: 'test.pdf',
        buffer: Buffer.from('%PDF-test content'),
        mimetype: 'application/pdf',
        size: 1000,
      } as Express.Multer.File;

      const mockCreateResult = {
        id: 'test-uuid',
        name: 'test.pdf',
        type: FileType.PDF,
        status: DocumentStatus.PROCESSING,
        fileSize: 1000,
      } as Document;

      jest.spyOn(documentService, 'create').mockResolvedValue(mockCreateResult);
      jest.spyOn(documentService, 'update').mockResolvedValue(mockCreateResult);
      const result = await controller.uploadFile(mockFile, {});

      expect(result).toEqual({
        success: true,
        data: { documentId: 'test-uuid', jobId: 'job-1', status: DocumentStatus.PROCESSING },
      });
      expect(documentService.create).toHaveBeenCalled();
      expect(rustfsService.uploadFile).toHaveBeenCalledWith('test-uuid/test.pdf', mockFile.buffer, mockFile.mimetype);
      expect(documentService.update).toHaveBeenCalledWith(
        'test-uuid',
        expect.objectContaining({ storageKey: 'test-uuid/test.pdf' }),
      );
      expect(mockIngestionService.enqueue).toHaveBeenCalledWith(
        'test-uuid',
        'http://localhost:9004/documents/test-uuid/test.pdf',
        'test.pdf',
        expect.stringMatching(/^[a-f0-9]{64}$/),
      );
    });

    it('should preserve Chinese file names when uploading', async () => {
      const mockFile = {
        originalname: '测试文档.md',
        buffer: Buffer.from('测试内容'),
        mimetype: 'text/markdown',
        size: 200,
      } as Express.Multer.File;

      const mockCreateResult = {
        id: 'test-uuid',
        name: '测试文档.md',
        type: FileType.MD,
        status: DocumentStatus.PROCESSING,
        fileSize: 200,
      } as Document;

      jest.spyOn(documentService, 'create').mockResolvedValue(mockCreateResult);
      jest.spyOn(documentService, 'update').mockResolvedValue(mockCreateResult);
      jest.spyOn(documentService, 'findById').mockResolvedValue({
        ...mockCreateResult,
        status: DocumentStatus.PROCESSED,
        chunkCount: 2,
        chunks: [],
      });

      await controller.uploadFile(mockFile, {});

      expect(documentService.create).toHaveBeenCalledWith(expect.objectContaining({ name: '测试文档.md' }));
      expect(rustfsService.uploadFile).toHaveBeenCalledWith(
        'test-uuid/测试文档.md',
        mockFile.buffer,
        mockFile.mimetype,
      );
    });

    it('should decode garbled latin1 Chinese file names before upload', async () => {
      const mockFile = {
        originalname: Buffer.from('测试文档.md', 'utf8').toString('latin1'),
        buffer: Buffer.from('测试内容'),
        mimetype: 'text/markdown',
        size: 200,
      } as Express.Multer.File;

      const mockCreateResult = {
        id: 'test-uuid',
        name: '测试文档.md',
        type: FileType.MD,
        status: DocumentStatus.PROCESSING,
        fileSize: 200,
      } as Document;

      jest.spyOn(documentService, 'create').mockResolvedValue(mockCreateResult);
      jest.spyOn(documentService, 'update').mockResolvedValue(mockCreateResult);
      jest.spyOn(documentService, 'findById').mockResolvedValue({
        ...mockCreateResult,
        status: DocumentStatus.PROCESSED,
        chunkCount: 2,
        chunks: [],
      });

      await controller.uploadFile(mockFile, {});

      expect(documentService.create).toHaveBeenCalledWith(expect.objectContaining({ name: '测试文档.md' }));
      expect(rustfsService.uploadFile).toHaveBeenCalledWith(
        'test-uuid/测试文档.md',
        mockFile.buffer,
        mockFile.mimetype,
      );
    });

    it('should throw error if no file or URL provided', async () => {
      await expect(controller.uploadFile(null, {})).rejects.toThrow('No file or URL provided');
    });

    it('should handle URL upload', async () => {
      const mockCreateResult = {
        id: 'test-uuid',
        name: 'https://example.com/doc.pdf',
        type: FileType.URL,
        status: DocumentStatus.PROCESSING,
        url: 'https://example.com/doc.pdf',
      } as Document;

      jest.spyOn(documentService, 'create').mockResolvedValue(mockCreateResult);
      const result = await controller.uploadFile(null, {
        url: 'https://example.com/doc.pdf',
      });

      expect(result).toEqual({
        success: true,
        data: { documentId: 'test-uuid', jobId: 'job-1', status: DocumentStatus.PROCESSING },
      });
      expect(rustfsService.uploadFile).not.toHaveBeenCalled();
      expect(mockIngestionService.enqueue).toHaveBeenCalledWith(
        'test-uuid',
        'https://example.com/doc.pdf',
        'https://example.com/doc.pdf',
        expect.stringMatching(/^[a-f0-9]{64}$/),
      );
    });
  });
});
