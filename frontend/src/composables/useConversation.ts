import { ref } from 'vue';
import http, { baseURL } from '@/core/http';
import type { Conversation, Message, ApiResponse } from '@/types';

interface SseMessage {
  type: 'message' | 'done' | 'error';
  content?: string;
  conversationId?: string;
  message?: string;
}

export function useConversation() {
  const conversations = ref<Conversation[]>([]);
  const currentConversation = ref<Conversation | null>(null);
  const messages = ref<Message[]>([]);
  const isLoading = ref(false);

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
    messages.value = conversation.messages || [];
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
    messages.value = [];
  };

  const sendMessage = (messageText: string): void => {
    if (!messageText.trim() || isLoading.value) return;

    const userMessage: Message = {
      id: `${Date.now()}`,
      role: 'user',
      content: messageText.trim(),
      createdAt: new Date(),
    };
    messages.value.push(userMessage);
    isLoading.value = true;

    const assistantMessage: Message = {
      id: `${Date.now()}-assistant`,
      role: 'assistant',
      content: '',
      createdAt: new Date(),
    };
    messages.value.push(assistantMessage);

    const params = new URLSearchParams({
      message: messageText.trim(),
      userId: 'default',
    });

    if (currentConversation.value?.id) {
      params.set('conversationId', String(currentConversation.value.id));
    }

    const eventSource = new EventSource(`${baseURL}/api/conversations/chat?${params.toString()}`);
    let streamCompleted = false;

    eventSource.onmessage = (event) => {
      try {
        if (typeof event.data !== 'string') {
          return;
        }

        const data = JSON.parse(event.data) as SseMessage;
        if (data.type === 'message') {
          assistantMessage.content += data.content ?? '';
          if (!currentConversation.value?.id && data.conversationId) {
            currentConversation.value = {
              ...currentConversation.value!,
              id: data.conversationId,
              userId: currentConversation.value?.userId || 'default',
            };
          }
        } else if (data.type === 'done') {
          streamCompleted = true;
          if (!currentConversation.value?.id && data.conversationId) {
            currentConversation.value = {
              ...currentConversation.value!,
              id: data.conversationId,
              userId: currentConversation.value?.userId || 'default',
            };
          }
          void fetchConversations();
          eventSource.close();
          isLoading.value = false;
        }
      } catch (e) {
        console.error('Failed to parse SSE message:', e);
      }
    };

    eventSource.onerror = () => {
      if (eventSource.readyState === EventSource.CLOSED || streamCompleted) {
        return;
      }
      assistantMessage.content = '抱歉，服务器出错了，请稍后再试。';
      eventSource.close();
      isLoading.value = false;
    };
  };

  const deleteConversation = async (conversationId: string): Promise<void> => {
    if (!confirm('确定要删除这个会话吗？')) return;
    try {
      await http.delete(`/api/conversations/delete/${conversationId}`);
      await fetchConversations();
      if (currentConversation.value?.id === conversationId) {
        currentConversation.value = null;
        messages.value = [];
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  };

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
