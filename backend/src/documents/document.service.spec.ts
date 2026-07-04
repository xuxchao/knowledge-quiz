import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DocumentService } from './document.service';
import { Document, DocumentStatus } from '../entities/document.entity';
import { Neo4jService } from '../infrastructure/neo4j/neo4j.service';

describe('DocumentService', () => {
  let service: DocumentService;
  let documentRepository: any;
  let neo4jService: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentService,
        {
          provide: getRepositoryToken(Document),
          useValue: {
            create: jest.fn().mockImplementation((data) => ({ id: 'test-id', ...data })),
            save: jest.fn().mockResolvedValue({ id: 'test-id', name: 'test' }),
            findOne: jest.fn().mockResolvedValue({ id: 'test-id', chunks: [] }),
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
        {
          provide: Neo4jService,
          useValue: {
            deleteByDocumentId: jest.fn().mockResolvedValue(),
          },
        },
      ],
    }).compile();

    service = module.get<DocumentService>(DocumentService);
    documentRepository = module.get(getRepositoryToken(Document));
    neo4jService = module.get(Neo4jService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create document successfully', async () => {
      const createData = { name: 'Test Document', type: 'pdf' };
      const expectedResult = { id: 'test-id', name: 'Test Document', type: 'pdf' };

      documentRepository.create.mockReturnValue(expectedResult);
      documentRepository.save.mockResolvedValue(expectedResult);

      const result = await service.create(createData);

      expect(result).toEqual(expectedResult);
      expect(documentRepository.create).toHaveBeenCalledWith(createData);
      expect(documentRepository.save).toHaveBeenCalledWith(expectedResult);
    });

    it('should handle partial data', async () => {
      const createData = { name: 'Test' };

      await service.create(createData);

      expect(documentRepository.create).toHaveBeenCalledWith(createData);
    });
  });

  describe('findById', () => {
    it('should return document with chunks', async () => {
      const mockDocument = {
        id: 'test-id',
        name: 'Test',
        chunks: [{ id: 'chunk-1', content: 'Hello' }],
      };

      documentRepository.findOne.mockResolvedValue(mockDocument);

      const result = await service.findById('test-id');

      expect(result).toEqual(mockDocument);
      expect(result.chunks).toHaveLength(1);
      expect(documentRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'test-id' },
        relations: { chunks: true },
      });
    });

    it('should return null if document not found', async () => {
      documentRepository.findOne.mockResolvedValue(null);

      const result = await service.findById('non-existent');

      expect(result).toBeNull();
    });

    it('should handle empty id', async () => {
      documentRepository.findOne.mockResolvedValue(null);

      const result = await service.findById('');

      expect(result).toBeNull();
    });
  });

  describe('findAll', () => {
    it('should return documents with pagination', async () => {
      const mockDocuments = [
        { id: '1', name: 'Doc 1' },
        { id: '2', name: 'Doc 2' },
      ];
      const mockCount = 10;

      documentRepository.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([mockDocuments, mockCount]),
      });

      const [documents, count] = await service.findAll('test', 0, 10);

      expect(documents).toEqual(mockDocuments);
      expect(count).toBe(mockCount);
    });

    it('should filter documents by name', async () => {
      documentRepository.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      });

      await service.findAll('test-doc', 0, 10);

      expect(documentRepository.createQueryBuilder).toHaveBeenCalled();
    });

    it('should return all documents without name filter', async () => {
      documentRepository.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      });

      await service.findAll();

      expect(documentRepository.createQueryBuilder).toHaveBeenCalled();
    });

    it('should return empty array if no documents', async () => {
      documentRepository.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      });

      const [documents] = await service.findAll();

      expect(documents).toEqual([]);
    });
  });

  describe('update', () => {
    it('should update document and return updated data', async () => {
      const mockDocument = { id: 'test-id', name: 'Updated', chunks: [] };

      documentRepository.update.mockResolvedValue({ affected: 1 });
      documentRepository.findOne.mockResolvedValue(mockDocument);

      const result = await service.update('test-id', { name: 'Updated' });

      expect(result).toEqual(mockDocument);
      expect(documentRepository.update).toHaveBeenCalledWith('test-id', { name: 'Updated' });
      expect(documentRepository.findOne).toHaveBeenCalled();
    });

    it('should return null if document not found', async () => {
      documentRepository.update.mockResolvedValue({ affected: 0 });
      documentRepository.findOne.mockResolvedValue(null);

      const result = await service.update('non-existent', { name: 'Updated' });

      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete document and cleanup neo4j', async () => {
      await service.delete('test-id');

      expect(documentRepository.delete).toHaveBeenCalledWith('test-id');
      expect(neo4jService.deleteByDocumentId).toHaveBeenCalledWith('test-id');
    });

    it('should handle non-existent document', async () => {
      documentRepository.delete.mockResolvedValue({ affected: 0 });

      await expect(service.delete('non-existent')).resolves.not.toThrow();
    });
  });

  describe('updateStatus', () => {
    it('should update document status', async () => {
      await service.updateStatus('test-id', DocumentStatus.PROCESSED);

      expect(documentRepository.update).toHaveBeenCalledWith('test-id', {
        status: DocumentStatus.PROCESSED,
        errorMessage: undefined,
      });
    });

    it('should update document status with error message', async () => {
      await service.updateStatus('test-id', DocumentStatus.FAILED, 'Error processing');

      expect(documentRepository.update).toHaveBeenCalledWith('test-id', {
        status: DocumentStatus.FAILED,
        errorMessage: 'Error processing',
      });
    });

    it('should handle empty id', async () => {
      await service.updateStatus('', DocumentStatus.PROCESSING);

      expect(documentRepository.update).toHaveBeenCalled();
    });
  });
});