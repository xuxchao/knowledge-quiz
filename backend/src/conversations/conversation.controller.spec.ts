import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { ConversationController } from './conversation.controller';
import { ConversationService } from './conversation.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Conversation } from '../entities/conversation.entity';
import { Message } from '../entities/message.entity';
import { MemoryService } from '../memory/memory.service';

describe('ConversationController', () => {
  let controller: ConversationController;
  let conversationService: ConversationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot()],
      controllers: [ConversationController],
      providers: [
        ConversationService,
        {
          provide: getRepositoryToken(Conversation),
          useValue: {},
        },
        {
          provide: getRepositoryToken(Message),
          useValue: {},
        },
        { provide: MemoryService, useValue: { deleteConversationMemory: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    controller = module.get<ConversationController>(ConversationController);
    conversationService = module.get<ConversationService>(ConversationService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('listConversations', () => {
    it('should return conversations list', async () => {
      const mockConversations = [
        { id: '1', messages: [] },
        { id: '2', messages: [] },
      ];

      jest.spyOn(conversationService, 'findAll').mockResolvedValue([mockConversations, 2]);

      const result = await controller.listConversations({ userId: 'user-1', page: 1, limit: 20 });

      expect(result).toEqual({
        success: true,
        data: mockConversations,
        pagination: { page: 1, limit: 20, total: 2, pages: 1 },
      });
      expect(conversationService.findAll).toHaveBeenCalledWith('user-1', 0, 20);
    });

    it('should return empty list if no conversations', async () => {
      jest.spyOn(conversationService, 'findAll').mockResolvedValue([[], 0]);

      const result = await controller.listConversations({ userId: 'user-1', page: 1, limit: 20 });

      expect(result).toEqual({
        success: true,
        data: [],
        pagination: { page: 1, limit: 20, total: 0, pages: 0 },
      });
    });

    it('should handle empty user id', async () => {
      jest.spyOn(conversationService, 'findAll').mockResolvedValue([[], 0]);

      const result = await controller.listConversations({ userId: '', page: 1, limit: 20 });

      expect(result).toEqual({
        success: true,
        data: [],
        pagination: { page: 1, limit: 20, total: 0, pages: 0 },
      });
    });
  });

  describe('getConversation', () => {
    it('should return conversation by id', async () => {
      const mockConversation = {
        id: '1',
        messages: [
          { id: 'm1', content: 'Hello' },
          { id: 'm2', content: 'Hi' },
        ],
      };

      jest.spyOn(conversationService, 'findOwnedById').mockResolvedValue(mockConversation as Conversation);
      jest.spyOn(conversationService, 'findWithMessagePage').mockResolvedValue(mockConversation as Conversation);

      const result = await controller.getConversation('1');

      expect(result).toEqual({
        success: true,
        data: mockConversation,
      });
      expect(result.data.messages).toHaveLength(2);
      expect(conversationService.findOwnedById).toHaveBeenCalledWith('1', 'default');
      expect(conversationService.findWithMessagePage).toHaveBeenCalledWith('1', 50, undefined);
    });

    it('should throw error if conversation not found', async () => {
      jest.spyOn(conversationService, 'findOwnedById').mockResolvedValue(null);

      await expect(controller.getConversation('non-existent')).rejects.toThrow();
    });

    it('should handle empty id', async () => {
      jest.spyOn(conversationService, 'findOwnedById').mockResolvedValue(null);

      await expect(controller.getConversation('')).rejects.toThrow();
    });

    it('should handle conversation with no messages', async () => {
      const mockConversation = { id: '1', messages: [] };

      jest.spyOn(conversationService, 'findOwnedById').mockResolvedValue(mockConversation as Conversation);
      jest.spyOn(conversationService, 'findWithMessagePage').mockResolvedValue(mockConversation as Conversation);

      const result = await controller.getConversation('1');

      expect(result.data.messages).toEqual([]);
    });
  });

  describe('deleteConversation', () => {
    it('should delete conversation successfully', async () => {
      const mockConversation = { id: '1', messages: [] };

      jest.spyOn(conversationService, 'findOwnedById').mockResolvedValue(mockConversation as Conversation);
      jest.spyOn(conversationService, 'delete').mockResolvedValue();

      const result = await controller.deleteConversation('1');

      expect(result).toEqual({
        success: true,
        message: 'Conversation deleted successfully',
      });
      expect(conversationService.findOwnedById).toHaveBeenCalledWith('1', 'default');
      expect(jest.spyOn(conversationService, 'delete')).toHaveBeenCalledWith('1');
    });

    it('should throw error if conversation not found', async () => {
      jest.spyOn(conversationService, 'findOwnedById').mockResolvedValue(null);

      await expect(controller.deleteConversation('non-existent')).rejects.toThrow();
    });

    it('should handle empty id', async () => {
      jest.spyOn(conversationService, 'findOwnedById').mockResolvedValue(null);

      await expect(controller.deleteConversation('')).rejects.toThrow();
    });
  });
});
