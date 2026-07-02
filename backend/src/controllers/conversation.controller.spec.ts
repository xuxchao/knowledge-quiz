import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { ConversationController } from './conversation.controller';
import { ConversationService } from '../services/conversation.service';
import { AiService } from '../services/ai.service';
import { MemoryService } from '../services/memory.service';
import { Neo4jService } from '../services/neo4j.service';
import { RedisService } from '../services/redis.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Conversation } from '../entities/conversation.entity';
import { Message } from '../entities/message.entity';

describe('ConversationController', () => {
  let controller: ConversationController;
  let conversationService: ConversationService;
  let memoryService: MemoryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot()],
      controllers: [ConversationController],
      providers: [
        ConversationService,
        AiService,
        MemoryService,
        Neo4jService,
        RedisService,
        {
          provide: getRepositoryToken(Conversation),
          useValue: {},
        },
        {
          provide: getRepositoryToken(Message),
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get<ConversationController>(ConversationController);
    conversationService = module.get<ConversationService>(ConversationService);
    memoryService = module.get<MemoryService>(MemoryService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('listConversations', () => {
    it('should return conversations list', async () => {
      const mockConversations = [];
      
      jest.spyOn(conversationService, 'findAll').mockResolvedValue(mockConversations);

      const result = await controller.listConversations('user-1');

      expect(result).toEqual({
        success: true,
        data: mockConversations,
      });
    });
  });

  describe('getConversation', () => {
    it('should return conversation by id', async () => {
      const mockConversation = { id: '1', messages: [] };
      
      jest.spyOn(conversationService, 'findById').mockResolvedValue(mockConversation as any);

      const result = await controller.getConversation('1');

      expect(result).toEqual({
        success: true,
        data: mockConversation,
      });
    });

    it('should return 404 if conversation not found', async () => {
      jest.spyOn(conversationService, 'findById').mockResolvedValue(null);

      await expect(controller.getConversation('1')).rejects.toThrow();
    });
  });

  describe('deleteConversation', () => {
    it('should delete conversation successfully', async () => {
      const mockConversation = { id: '1', messages: [] };
      
      jest.spyOn(conversationService, 'findById').mockResolvedValue(mockConversation as any);
      jest.spyOn(conversationService, 'delete').mockResolvedValue();
      jest.spyOn(memoryService, 'clearShortTermMemory').mockResolvedValue();

      const result = await controller.deleteConversation('1');

      expect(result).toEqual({
        success: true,
        message: 'Conversation deleted successfully',
      });
    });

    it('should return 404 if conversation not found', async () => {
      jest.spyOn(conversationService, 'findById').mockResolvedValue(null);

      await expect(controller.deleteConversation('1')).rejects.toThrow();
    });
  });
});
