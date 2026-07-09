import { computed, shallowRef, watch } from 'vue';
import { useChat } from '@ai-sdk/vue';
import { DefaultChatTransport, type UIMessage } from 'ai';
import http, { baseURL } from '@/core/http';
import type { Conversation, Message, ApiResponse } from '@/types';

type ConversationDataParts = {
  'conversation-id': {
    conversationId: string;
  };
};

type ConversationUIMessage = UIMessage<unknown, ConversationDataParts>;

export function useConversation() {
  const conversations = shallowRef<Conversation[]>([]);
  const currentConversation = shallowRef<Conversation | null>(null);

  const {
    messages: aiMessages,
    status,
    error,
    sendMessage: sendAiMessage,
  } = useChat<ConversationUIMessage>({
    transport: new DefaultChatTransport<ConversationUIMessage>({
      api: `${baseURL}/api/conversations/chat`,
      prepareSendMessagesRequest: ({ messages }) => ({
        body: {
          messages,
          conversationId: currentConversation.value?.id || undefined,
          userId: currentConversation.value?.userId || 'default',
        },
      }),
    }),
    messages: [],
    onData: (dataPart) => {
      if (dataPart.type !== 'data-conversation-id') return;
      const conversationId = dataPart.data.conversationId;
      if (!conversationId || currentConversation.value?.id) return;
      const current = currentConversation.value;
      currentConversation.value = {
        ...(current ?? {
          messages: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        id: conversationId,
        userId: current?.userId || 'default',
      };
    },
    onFinish: () => {
      void fetchConversations();
    },
    onError: (chatError) => {
      console.error('Failed to send chat message:', chatError);
    },
  });

  const messages = computed<Message[]>(() => aiMessages.value.map(toDisplayMessage));
  const isLoading = computed(() => status.value === 'submitted' || status.value === 'streaming');

  const fetchConversations = async (): Promise<void> => {
    try {
      const response = await http.get<ApiResponse<Conversation[]>>('/api/conversations');
      conversations.value = response.data.data || [];
      if (conversations.value.length > 0 && !currentConversation.value?.id) {
        selectConversation(conversations.value[0]);
      }
    } catch (error) {
      console.error('Failed to fetch conversations:', error);
    }
  };

  const selectConversation = (conversation: Conversation): void => {
    currentConversation.value = conversation;
    aiMessages.value = toUiMessages(conversation.messages || []);
  };

  const createNewConversation = (): void => {
    const newConversation: Conversation = {
      id: '',
      userId: 'default',
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    currentConversation.value = newConversation;
    aiMessages.value = [];
  };

  const sendMessage = (messageText: string): void => {
    if (!messageText.trim() || isLoading.value) return;
    void sendAiMessage({ text: messageText.trim() });
  };

  const deleteConversation = async (conversationId: string): Promise<void> => {
    if (!confirm('确定要删除这个会话吗？')) return;
    try {
      await http.delete(`/api/conversations/delete/${conversationId}`);
      await fetchConversations();
      if (currentConversation.value?.id === conversationId) {
        currentConversation.value = null;
        aiMessages.value = [];
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  };

  watch(error, (chatError) => {
    if (!chatError) return;
    aiMessages.value = [
      ...aiMessages.value,
      {
        id: `${Date.now()}-error`,
        role: 'assistant',
        parts: [{ type: 'text', text: '抱歉，服务器出错了，请稍后再试。' }],
      },
    ];
  });

  return {
    conversations,
    currentConversation,
    messages,
    isLoading,
    fetchConversations,
    selectConversation,
    createNewConversation,
    sendMessage,
    deleteConversation,
  };
}

const toUiMessages = (savedMessages: Message[]): ConversationUIMessage[] =>
  savedMessages.map((message) => ({
    id: message.id,
    role: message.role,
    parts: [{ type: 'text', text: message.content }],
  }));

const toDisplayMessage = (message: ConversationUIMessage): Message => ({
  id: message.id,
  role: message.role === 'user' ? 'user' : 'assistant',
  content: message.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join(''),
  createdAt: new Date(),
});
