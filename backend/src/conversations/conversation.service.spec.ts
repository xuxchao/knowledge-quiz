import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConversationService } from './conversation.service';
import { Conversation } from '../entities/conversation.entity';
import { Message, MessageRole } from '../entities/message.entity';

describe('ConversationService', () => {
  let service: ConversationService;
  let conversationRepository: any;
  let messageRepository: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationService,
        {
          provide: getRepositoryToken(Conversation),
          useValue: {
            create: jest.fn().mockImplementation((data) => ({ id: 'test-id', ...data })),
            save: jest.fn().mockResolvedValue({ id: 'test-id', name: 'test' }),
            findOne: jest.fn().mockResolvedValue({ id: 'test-id', messages: [] }),
            createQueryBuilder: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnThis(),
              orderBy: jest.fn().mockReturnThis(),
              skip: jest.fn().mockReturnThis(),
              take: jest.fn().mockReturnThis(),
              getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
            }),
            increment: jest.fn().mockResolvedValue({ affected: 1 }),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
            delete: jest.fn().mockResolvedValue({ affected: 1 }),
          },
        },
        {
          provide: getRepositoryToken(Message),
          useValue: {
            create: jest.fn().mockImplementation((data) => ({ id: 'msg-id', ...data })),
            save: jest.fn().mockResolvedValue({ id: 'msg-id', content: 'test' }),
            find: jest.fn().mockResolvedValue([]),
            delete: jest.fn().mockResolvedValue({ affected: 1 }),
          },
        },
      ],
    }).compile();

    service = module.get<ConversationService>(ConversationService);
    conversationRepository = module.get(getRepositoryToken(Conversation));
    messageRepository = module.get(getRepositoryToken(Message));
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create conversation successfully', async () => {
      const createData = { name: 'Test Conversation' };
      const expectedResult = { id: 'test-id', name: 'Test Conversation' };

      conversationRepository.create.mockReturnValue(expectedResult);
      conversationRepository.save.mockResolvedValue(expectedResult);

      const result = await service.create(createData);

      expect(result).toEqual(expectedResult);
      expect(conversationRepository.create).toHaveBeenCalledWith(createData);
      expect(conversationRepository.save).toHaveBeenCalledWith(expectedResult);
    });

    it('should handle empty create data', async () => {
      const createData = {};
      const expectedResult = { id: 'test-id' };

      conversationRepository.create.mockReturnValue(expectedResult);
      conversationRepository.save.mockResolvedValue(expectedResult);

      const result = await service.create(createData);

      expect(result).toEqual(expectedResult);
    });
  });

  describe('findById', () => {
    it('should return conversation with messages', async () => {
      const mockConversation = {
        id: 'test-id',
        name: 'Test',
        messages: [{ id: 'msg-1', content: 'Hello' }],
      };

      conversationRepository.findOne.mockResolvedValue(mockConversation);
      messageRepository.find.mockResolvedValue(mockConversation.messages);

      const result = await service.findById('test-id');

      expect(result).toEqual(mockConversation);
      expect(result.messages).toHaveLength(1);
      expect(conversationRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'test-id' },
      });
      expect(messageRepository.find).toHaveBeenCalledWith({
        where: { conversationId: 'test-id' },
        order: { createdAt: 'ASC' },
        skip: 0,
        take: 100,
      });
    });

    it('should return null if conversation not found', async () => {
      conversationRepository.findOne.mockResolvedValue(null);

      const result = await service.findById('non-existent');

      expect(result).toBeNull();
    });

    it('should handle empty id', async () => {
      conversationRepository.findOne.mockResolvedValue(null);

      const result = await service.findById('');

      expect(result).toBeNull();
    });
  });

  describe('findAll', () => {
    it('should return all conversations for user', async () => {
      const mockConversations = [
        { id: '1', name: 'Conv 1' },
        { id: '2', name: 'Conv 2' },
      ];

      conversationRepository.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([mockConversations, 2]),
      });

      const result = await service.findAll('user-1');

      expect(result).toEqual([mockConversations, 2]);
      expect(result[0]).toHaveLength(2);
    });

    it('should not join messages into the conversation list', async () => {
      const queryBuilder = {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[{ id: '1', title: '历史对话', messageCount: 2 }], 1]),
      };

      conversationRepository.createQueryBuilder.mockReturnValue(queryBuilder);

      const result = await service.findAll('user-1');

      expect(queryBuilder.orderBy).toHaveBeenCalledWith('conversation.updatedAt', 'DESC');
      expect(result[0][0].messages).toBeUndefined();
      expect(result[0][0].messageCount).toBe(2);
    });

    it('should return all conversations without user filter', async () => {
      const mockConversations = [{ id: '1', name: 'Conv 1' }];

      conversationRepository.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([mockConversations, 1]),
      });

      const result = await service.findAll();

      expect(result).toEqual([mockConversations, 1]);
    });

    it('should return empty array if no conversations', async () => {
      conversationRepository.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      });

      const result = await service.findAll('user-1');

      expect(result).toEqual([[], 0]);
    });
  });

  describe('delete', () => {
    it('should delete conversation and its messages', async () => {
      await service.delete('test-id');

      expect(messageRepository.delete).toHaveBeenCalledWith({
        conversationId: 'test-id',
      });
      expect(conversationRepository.delete).toHaveBeenCalledWith('test-id');
    });

    it('should handle non-existent conversation', async () => {
      messageRepository.delete.mockResolvedValue({ affected: 0 });
      conversationRepository.delete.mockResolvedValue({ affected: 0 });

      await expect(service.delete('non-existent')).resolves.not.toThrow();
    });
  });

  describe('createMessage', () => {
    it('should create message and update conversation', async () => {
      const mockMessage = {
        id: 'msg-id',
        conversationId: 'conv-1',
        role: MessageRole.USER,
        content: 'Hello',
      };

      messageRepository.create.mockReturnValue(mockMessage);
      messageRepository.save.mockResolvedValue(mockMessage);

      const result = await service.createMessage('conv-1', MessageRole.USER, 'Hello');

      expect(result).toEqual(mockMessage);
      expect(messageRepository.create).toHaveBeenCalledWith({
        conversationId: 'conv-1',
        role: MessageRole.USER,
        content: 'Hello',
        references: [],
      });
      expect(messageRepository.save).toHaveBeenCalled();
      expect(conversationRepository.update).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({ updatedAt: expect.any(Date) }),
      );
      expect(conversationRepository.increment).toHaveBeenCalledWith({ id: 'conv-1' }, 'messageCount', 1);
    });

    it('should handle empty content', async () => {
      await service.createMessage('conv-1', MessageRole.USER, '');

      expect(messageRepository.create).toHaveBeenCalledWith({
        conversationId: 'conv-1',
        role: MessageRole.USER,
        content: '',
        references: [],
      });
    });
  });

  describe('getMessages', () => {
    it('should return messages ordered by createdAt', async () => {
      const mockMessages = [
        { id: 'msg-1', content: 'First', createdAt: new Date('2024-01-01') },
        { id: 'msg-2', content: 'Second', createdAt: new Date('2024-01-02') },
      ];

      messageRepository.find.mockResolvedValue(mockMessages);

      const result = await service.getMessages('conv-1');

      expect(result).toEqual(mockMessages);
      expect(messageRepository.find).toHaveBeenCalledWith({
        where: { conversationId: 'conv-1' },
        order: { createdAt: 'ASC' },
        skip: 0,
        take: 100,
      });
    });

    it('should return empty array if no messages', async () => {
      messageRepository.find.mockResolvedValue([]);

      const result = await service.getMessages('conv-1');

      expect(result).toEqual([]);
    });
  });
});
