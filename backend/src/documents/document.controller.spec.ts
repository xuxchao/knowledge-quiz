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

describe('DocumentController', () => {
  let controller: DocumentController;
  let documentService: DocumentService;
  let fileProcessorService: FileProcessorService;
  let chunkService: ChunkService;
  let rustfsService: RustfsService;

  const mockRustfsService = {
    uploadFile: jest.fn().mockResolvedValue('http://localhost:9004/documents/test-uuid/test.pdf'),
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
    storeChunks: jest.fn(),
  };

  const mockChunkService = {
    createForDocument: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockFileProcessorService.processFile.mockResolvedValue({
      text: 'test content',
      metadata: { numPages: 1, author: 'Test' },
    });
    mockFileProcessorService.chunkText.mockReturnValue(['chunk1', 'chunk2']);
    mockFileProcessorService.storeChunks.mockResolvedValue();
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
    fileProcessorService = module.get<FileProcessorService>(FileProcessorService);
    chunkService = module.get<ChunkService>(ChunkService);
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

      const result = await controller.listDocuments('', 1, 10);

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

      await controller.listDocuments('test', 1, 10);

      expect(documentService.findAll).toHaveBeenCalledWith('test', 0, 10);
    });

    it('should handle page 0 by defaulting to page 1', async () => {
      jest.spyOn(documentService, 'findAll').mockResolvedValue([[], 0]);

      await controller.listDocuments('', 0, 10);

      expect(documentService.findAll).toHaveBeenCalledWith('', 0, 10);
    });

    it('should handle negative page by defaulting to page 1', async () => {
      jest.spyOn(documentService, 'findAll').mockResolvedValue([[], 0]);

      await controller.listDocuments('', -1, 10);

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

  describe('uploadFile', () => {
    it('should upload and process PDF file successfully', async () => {
      const mockFile = {
        originalname: 'test.pdf',
        buffer: Buffer.from('test content'),
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
      jest.spyOn(documentService, 'findById').mockResolvedValue({
        ...mockCreateResult,
        status: DocumentStatus.PROCESSED,
        chunkCount: 2,
        chunks: [],
      });

      const result = await controller.uploadFile(mockFile, {});

      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          id: 'test-uuid',
          name: 'test.pdf',
          status: DocumentStatus.PROCESSED,
          chunkCount: 2,
        }),
      });
      expect(documentService.create).toHaveBeenCalled();
      expect(rustfsService.uploadFile).toHaveBeenCalledWith('test-uuid/test.pdf', mockFile.buffer, mockFile.mimetype);
      expect(fileProcessorService.processFile).toHaveBeenCalled();
      expect(fileProcessorService.chunkText).toHaveBeenCalledWith('test content');
      expect(fileProcessorService.storeChunks).toHaveBeenCalledWith('test-uuid', ['chunk1', 'chunk2']);
      expect(chunkService.createForDocument).toHaveBeenCalledWith('test-uuid', ['chunk1', 'chunk2']);
    });

    it('should throw error if no file or URL provided', async () => {
      await expect(controller.uploadFile(null, {})).rejects.toThrow('No file or URL provided');
    });

    it('should handle file processing failure', async () => {
      const mockFile = {
        originalname: 'test.pdf',
        buffer: Buffer.from('test content'),
        mimetype: 'application/pdf',
        size: 1000,
      } as Express.Multer.File;

      jest.spyOn(documentService, 'create').mockResolvedValue({
        id: 'test-uuid',
        name: 'test.pdf',
        type: FileType.PDF,
        status: DocumentStatus.PROCESSING,
      } as Document);
      jest.spyOn(fileProcessorService, 'processFile').mockRejectedValue(new Error('Processing failed'));

      await expect(controller.uploadFile(mockFile, {})).rejects.toThrow('File processing failed: Processing failed');
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
      jest.spyOn(documentService, 'update').mockResolvedValue(mockCreateResult);
      jest.spyOn(documentService, 'findById').mockResolvedValue({
        ...mockCreateResult,
        status: DocumentStatus.PROCESSED,
        chunkCount: 2,
        chunks: [],
      });

      const result = await controller.uploadFile(null, {
        url: 'https://example.com/doc.pdf',
      });

      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          id: 'test-uuid',
          type: FileType.URL,
          status: DocumentStatus.PROCESSED,
        }),
      });
      expect(rustfsService.uploadFile).not.toHaveBeenCalled();
      expect(fileProcessorService.processFile).toHaveBeenCalled();
    });

    it('should handle unknown file type', async () => {
      const mockFile = {
        originalname: 'test.unknown',
        buffer: Buffer.from('test content'),
        mimetype: 'application/octet-stream',
        size: 1000,
      } as Express.Multer.File;

      jest.spyOn(documentService, 'create').mockResolvedValue({
        id: 'test-uuid',
        name: 'test.unknown',
        type: FileType.TXT,
        status: DocumentStatus.PROCESSING,
      } as Document);
      jest.spyOn(documentService, 'update').mockResolvedValue({
        id: 'test-uuid',
        name: 'test.unknown',
        type: FileType.TXT,
        status: DocumentStatus.PROCESSED,
        chunkCount: 2,
        chunks: [],
      } as Document);
      jest.spyOn(documentService, 'findById').mockResolvedValue({
        id: 'test-uuid',
        name: 'test.unknown',
        type: FileType.TXT,
        status: DocumentStatus.PROCESSED,
        chunkCount: 2,
        chunks: [],
      } as Document);

      const result = await controller.uploadFile(mockFile, {});

      expect(result.success).toBe(true);
      expect(result.data.type).toBe(FileType.TXT);
    });

    it('should handle empty file', async () => {
      const mockFile = {
        originalname: 'empty.pdf',
        buffer: Buffer.from(''),
        mimetype: 'application/pdf',
        size: 0,
      } as Express.Multer.File;

      jest.spyOn(documentService, 'create').mockResolvedValue({
        id: 'test-uuid',
        name: 'empty.pdf',
        type: FileType.PDF,
        status: DocumentStatus.PROCESSING,
        fileSize: 0,
      } as Document);
      jest.spyOn(fileProcessorService, 'processFile').mockResolvedValue({
        text: '',
        metadata: {},
      });
      jest.spyOn(fileProcessorService, 'chunkText').mockReturnValue([]);
      jest.spyOn(documentService, 'update').mockResolvedValue({
        id: 'test-uuid',
        name: 'empty.pdf',
        type: FileType.PDF,
        status: DocumentStatus.PROCESSED,
        chunkCount: 0,
        chunks: [],
      } as Document);
      jest.spyOn(documentService, 'findById').mockResolvedValue({
        id: 'test-uuid',
        name: 'empty.pdf',
        type: FileType.PDF,
        status: DocumentStatus.PROCESSED,
        chunkCount: 0,
        chunks: [],
      } as Document);

      const result = await controller.uploadFile(mockFile, {});

      expect(result.success).toBe(true);
      expect(result.data.chunkCount).toBe(0);
      expect(chunkService.createForDocument).toHaveBeenCalledWith('test-uuid', []);
    });
  });
});
