<script setup lang="ts">
import { onMounted } from 'vue';
import { MessageSquare } from 'lucide-vue-next';
import ConversationList from '@/components/conversation/ConversationList.vue';
import MessageList from '@/components/conversation/MessageList.vue';
import ChatInput from '@/components/conversation/ChatInput.vue';
import { useConversation } from '@/composables/useConversation';

const {
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
} = useConversation();

onMounted(() => {
  void fetchConversations();
});
</script>

<template>
  <div class="flex h-[calc(100vh-8rem)] bg-white rounded-lg shadow-lg overflow-hidden">
    <ConversationList
      :conversations="conversations"
      :current-conversation="currentConversation"
      @create="createNewConversation"
      @select="selectConversation"
      @delete="deleteConversation"
    />

    <div class="flex-1 flex flex-col">
      <template v-if="currentConversation">
        <MessageList
          :messages="messages"
          :is-loading="isLoading"
          :is-conversation-loading="isConversationLoading"
          :is-loading-older-messages="isLoadingOlderMessages"
          :has-older-messages="hasOlderMessages"
          @load-older="loadOlderMessages"
        />
        <ChatInput :disabled="isLoading" @send="sendMessage" />
      </template>

      <div v-else class="flex-1 flex flex-col items-center justify-center text-gray-500">
        <MessageSquare class="w-16 h-16 mb-4 text-gray-300" />
        <p>选择或创建一个会话开始聊天</p>
      </div>
    </div>
  </div>
</template>
