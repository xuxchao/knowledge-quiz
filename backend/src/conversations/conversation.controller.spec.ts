import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { ConversationController } from './conversation.controller';
import { ConversationService } from './conversation.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Conversation } from '../entities/conversation.entity';
import { Message } from '../entities/message.entity';

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

      jest
        .spyOn(conversationService, 'findAll')
        .mockResolvedValue(mockConversations);

      const result = await controller.listConversations('user-1');

      expect(result).toEqual({
        success: true,
        data: mockConversations,
      });
      expect(conversationService.findAll).toHaveBeenCalledWith('user-1');
    });

    it('should return empty list if no conversations', async () => {
      jest.spyOn(conversationService, 'findAll').mockResolvedValue([]);

      const result = await controller.listConversations('user-1');

      expect(result).toEqual({
        success: true,
        data: [],
      });
    });

    it('should handle empty user id', async () => {
      jest.spyOn(conversationService, 'findAll').mockResolvedValue([]);

      const result = await controller.listConversations('');

      expect(result).toEqual({
        success: true,
        data: [],
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

      jest
        .spyOn(conversationService, 'findById')
        .mockResolvedValue(mockConversation as Conversation);

      const result = await controller.getConversation('1');

      expect(result).toEqual({
        success: true,
        data: mockConversation,
      });
      expect(result.data.messages).toHaveLength(2);
      expect(conversationService.findById).toHaveBeenCalledWith('1');
    });

    it('should throw error if conversation not found', async () => {
      jest.spyOn(conversationService, 'findById').mockResolvedValue(null);

      await expect(
        controller.getConversation('non-existent'),
      ).rejects.toThrow();
    });

    it('should handle empty id', async () => {
      jest.spyOn(conversationService, 'findById').mockResolvedValue(null);

      await expect(controller.getConversation('')).rejects.toThrow();
    });

    it('should handle conversation with no messages', async () => {
      const mockConversation = { id: '1', messages: [] };

      jest
        .spyOn(conversationService, 'findById')
        .mockResolvedValue(mockConversation as Conversation);

      const result = await controller.getConversation('1');

      expect(result.data.messages).toEqual([]);
    });
  });

  describe('deleteConversation', () => {
    it('should delete conversation successfully', async () => {
      const mockConversation = { id: '1', messages: [] };

      jest
        .spyOn(conversationService, 'findById')
        .mockResolvedValue(mockConversation as Conversation);
      jest.spyOn(conversationService, 'delete').mockResolvedValue();

      const result = await controller.deleteConversation('1');

      expect(result).toEqual({
        success: true,
        message: 'Conversation deleted successfully',
      });
      expect(jest.spyOn(conversationService, 'findById')).toHaveBeenCalledWith(
        '1',
      );
      expect(jest.spyOn(conversationService, 'delete')).toHaveBeenCalledWith(
        '1',
      );
    });

    it('should throw error if conversation not found', async () => {
      jest.spyOn(conversationService, 'findById').mockResolvedValue(null);

      await expect(
        controller.deleteConversation('non-existent'),
      ).rejects.toThrow();
    });

    it('should handle empty id', async () => {
      jest.spyOn(conversationService, 'findById').mockResolvedValue(null);

      await expect(controller.deleteConversation('')).rejects.toThrow();
    });
  });
});
