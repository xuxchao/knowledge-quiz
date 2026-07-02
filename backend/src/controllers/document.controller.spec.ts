import { Test, TestingModule } from '@nestjs/testing';
import { DocumentController } from './document.controller';
import { DocumentService } from '../services/document.service';
import { FileProcessorService } from '../services/file-processor.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Document } from '../entities/document.entity';
import { Neo4jService } from '../services/neo4j.service';

describe('DocumentController', () => {
  let controller: DocumentController;
  let documentService: DocumentService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DocumentController],
      providers: [
        DocumentService,
        FileProcessorService,
        Neo4jService,
        {
          provide: getRepositoryToken(Document),
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get<DocumentController>(DocumentController);
    documentService = module.get<DocumentService>(DocumentService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('listDocuments', () => {
    it('should return documents list with pagination', async () => {
      const mockDocuments = [];
      const mockCount = 0;
      
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
    });
  });

  describe('getDocument', () => {
    it('should return document by id', async () => {
      const mockDocument = { id: '1', name: 'test' };
      
      jest.spyOn(documentService, 'findById').mockResolvedValue(mockDocument as any);

      const result = await controller.getDocument('1');

      expect(result).toEqual({
        success: true,
        data: mockDocument,
      });
    });

    it('should return 404 if document not found', async () => {
      jest.spyOn(documentService, 'findById').mockResolvedValue(null);

      await expect(controller.getDocument('1')).rejects.toThrow();
    });
  });

  describe('deleteDocument', () => {
    it('should delete document successfully', async () => {
      const mockDocument = { id: '1', name: 'test' };
      
      jest.spyOn(documentService, 'findById').mockResolvedValue(mockDocument as any);
      jest.spyOn(documentService, 'delete').mockResolvedValue();

      const result = await controller.deleteDocument('1');

      expect(result).toEqual({
        success: true,
        message: 'Document deleted successfully',
      });
    });

    it('should return 404 if document not found', async () => {
      jest.spyOn(documentService, 'findById').mockResolvedValue(null);

      await expect(controller.deleteDocument('1')).rejects.toThrow();
    });
  });
});
