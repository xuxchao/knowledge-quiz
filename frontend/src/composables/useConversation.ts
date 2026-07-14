import { computed, shallowRef, watch } from 'vue';
import { useChat } from '@ai-sdk/vue';
import { DefaultChatTransport, type UIMessage } from 'ai';
import http, { baseURL } from '@/core/http';
import type { Conversation, DocumentReference, Message, ApiResponse } from '@/types';

type ConversationDataParts = {
  'conversation-id': {
    conversationId: string;
  };
  citations: {
    citations: DocumentReference[];
  };
};

type ConversationUIMessage = UIMessage<unknown, ConversationDataParts>;

export function useConversation() {
  const conversations = shallowRef<Conversation[]>([]);
  const currentConversation = shallowRef<Conversation | null>(null);
  const isConversationLoading = shallowRef(false);
  const isLoadingOlderMessages = shallowRef(false);
  const olderMessagesCursor = shallowRef<string | null>(null);
  const hasOlderMessages = shallowRef(false);
  const currentUserId = 'default';
  let selectionRequestId = 0;

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
          userId: currentConversation.value?.userId || currentUserId,
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
      const response = await http.get<ApiResponse<Conversation[]>>('/api/conversations', {
        params: { userId: currentUserId },
      });
      conversations.value = response.data.data || [];
      if (conversations.value.length > 0 && !currentConversation.value?.id) {
        selectConversation(conversations.value[0]);
      }
    } catch (error) {
      console.error('Failed to fetch conversations:', error);
    }
  };

  const selectConversation = (conversation: Conversation): void => {
    const requestId = ++selectionRequestId;
    currentConversation.value = conversation;
    aiMessages.value = [];
    olderMessagesCursor.value = null;
    hasOlderMessages.value = false;
    isConversationLoading.value = true;

    void http
      .get<ApiResponse<Conversation>>(`/api/conversations/get/${conversation.id}`, {
        params: { userId: conversation.userId || currentUserId, limit: 50 },
      })
      .then((response) => {
        if (requestId !== selectionRequestId) return;
        const details = response.data.data;
        currentConversation.value = details;
        aiMessages.value = toUiMessages(details.messages || []);
        olderMessagesCursor.value = details.messagePage?.nextCursor ?? null;
        hasOlderMessages.value = details.messagePage?.hasMore ?? false;
      })
      .catch((error: unknown) => {
        if (requestId !== selectionRequestId) return;
        console.error('Failed to fetch conversation messages:', error);
        aiMessages.value = [];
      })
      .finally(() => {
        if (requestId === selectionRequestId) {
          isConversationLoading.value = false;
        }
      });
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
    selectionRequestId += 1;
    isConversationLoading.value = false;
    isLoadingOlderMessages.value = false;
    olderMessagesCursor.value = null;
    hasOlderMessages.value = false;
  };

  const loadOlderMessages = async (): Promise<void> => {
    const conversation = currentConversation.value;
    const cursor = olderMessagesCursor.value;
    if (!conversation?.id || !cursor || !hasOlderMessages.value || isLoadingOlderMessages.value)
      return;

    isLoadingOlderMessages.value = true;
    try {
      const response = await http.get<ApiResponse<Conversation>>(
        `/api/conversations/get/${conversation.id}`,
        {
          params: { userId: conversation.userId || currentUserId, limit: 50, before: cursor },
        },
      );
      const details = response.data.data;
      const existingIds = new Set(aiMessages.value.map((message) => message.id));
      const olderMessages = toUiMessages(details.messages || []).filter(
        (message) => !existingIds.has(message.id),
      );
      aiMessages.value = [...olderMessages, ...aiMessages.value];
      olderMessagesCursor.value = details.messagePage?.nextCursor ?? null;
      hasOlderMessages.value = details.messagePage?.hasMore ?? false;
    } catch (error: unknown) {
      console.error('Failed to load older conversation messages:', error);
    } finally {
      isLoadingOlderMessages.value = false;
    }
  };

  const sendMessage = (messageText: string): void => {
    if (!messageText.trim() || isLoading.value) return;
    void sendAiMessage({ text: messageText.trim() });
  };

  const deleteConversation = async (conversationId: string): Promise<void> => {
    if (!confirm('确定要删除这个会话吗？')) return;
    try {
      await http.delete(`/api/conversations/delete/${conversationId}`, {
        params: { userId: currentUserId },
      });
      await fetchConversations();
      if (currentConversation.value?.id === conversationId) {
        selectionRequestId += 1;
        currentConversation.value = null;
        aiMessages.value = [];
        isConversationLoading.value = false;
        olderMessagesCursor.value = null;
        hasOlderMessages.value = false;
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
    isConversationLoading,
    isLoadingOlderMessages,
    hasOlderMessages,
    fetchConversations,
    selectConversation,
    createNewConversation,
    sendMessage,
    loadOlderMessages,
    deleteConversation,
  };
}

const toUiMessages = (savedMessages: Message[]): ConversationUIMessage[] =>
  savedMessages.map((message) => ({
    id: message.id,
    role: message.role,
    parts: [
      ...(message.references?.length
        ? ([{ type: 'data-citations', data: { citations: message.references } }] as const)
        : []),
      { type: 'text', text: message.content } as const,
    ],
  }));

const toDisplayMessage = (message: ConversationUIMessage): Message => ({
  id: message.id,
  role: message.role === 'user' ? 'user' : 'assistant',
  content: message.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join(''),
  references: message.parts
    .filter((part) => part.type === 'data-citations')
    .flatMap((part) => part.data.citations),
  createdAt: new Date(),
});
