import { Test, TestingModule } from '@nestjs/testing';
import { ChunkController } from './chunk.controller';
import { ChunkService } from '../services/chunk.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Chunk } from '../entities/chunk.entity';

describe('ChunkController', () => {
  let controller: ChunkController;
  let chunkService: ChunkService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChunkController],
      providers: [
        ChunkService,
        {
          provide: getRepositoryToken(Chunk),
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get<ChunkController>(ChunkController);
    chunkService = module.get<ChunkService>(ChunkService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('listChunks', () => {
    it('should return chunks list with pagination', async () => {
      const mockChunks = [];
      const mockCount = 0;
      
      jest.spyOn(chunkService, 'findByDocument').mockResolvedValue([mockChunks, mockCount]);

      const result = await controller.listChunks('doc-1', 1, 10);

      expect(result).toEqual({
        success: true,
        data: mockChunks,
        pagination: {
          page: 1,
          limit: 10,
          total: mockCount,
          pages: Math.ceil(mockCount / 10),
        },
      });
    });
  });

  describe('getChunk', () => {
    it('should return chunk by id', async () => {
      const mockChunk = { id: '1', content: 'test' };
      
      jest.spyOn(chunkService, 'findById').mockResolvedValue(mockChunk as any);

      const result = await controller.getChunk('1');

      expect(result).toEqual({
        success: true,
        data: mockChunk,
      });
    });

    it('should return 404 if chunk not found', async () => {
      jest.spyOn(chunkService, 'findById').mockResolvedValue(null);

      await expect(controller.getChunk('1')).rejects.toThrow();
    });
  });

  describe('updateChunk', () => {
    it('should update chunk successfully', async () => {
      const mockChunk = { id: '1', content: 'test' };
      const updatedChunk = { id: '1', content: 'updated' };
      
      jest.spyOn(chunkService, 'findById').mockResolvedValue(mockChunk as any);
      jest.spyOn(chunkService, 'update').mockResolvedValue(updatedChunk as any);

      const result = await controller.updateChunk('1', { content: 'updated' });

      expect(result).toEqual({
        success: true,
        data: updatedChunk,
      });
    });
  });

  describe('deleteChunk', () => {
    it('should delete chunk successfully', async () => {
      const mockChunk = { id: '1', content: 'test' };
      
      jest.spyOn(chunkService, 'findById').mockResolvedValue(mockChunk as any);
      jest.spyOn(chunkService, 'delete').mockResolvedValue();

      const result = await controller.deleteChunk('1');

      expect(result).toEqual({
        success: true,
        message: 'Chunk deleted successfully',
      });
    });
  });
});
