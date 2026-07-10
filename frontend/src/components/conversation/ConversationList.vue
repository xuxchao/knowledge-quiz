<script setup lang="ts">
import { Plus, MessageSquare, Trash2 } from 'lucide-vue-next';
import type { Conversation } from '@/types';

defineProps<{
  conversations: Conversation[];
  currentConversation: Conversation | null;
}>();

const emit = defineEmits<{
  create: [];
  select: [conversation: Conversation];
  delete: [conversationId: string];
}>();
</script>

<template>
  <div class="w-72 border-r border-gray-200 flex flex-col">
    <div class="p-4 border-b border-gray-200">
      <button
        class="w-full flex items-center justify-center space-x-2 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors"
        @click="emit('create')"
      >
        <Plus class="w-4 h-4" />
        <span>新建会话</span>
      </button>
    </div>

    <div class="flex-1 overflow-y-auto">
      <div
        v-for="conv in conversations"
        :key="conv.id"
        :class="[
          'p-4 border-b border-gray-100 cursor-pointer transition-colors flex justify-between items-start',
          currentConversation?.id === conv.id ? 'bg-blue-50' : 'hover:bg-gray-50',
        ]"
        @click="emit('select', conv)"
      >
        <div class="flex-1 min-w-0">
          <div class="flex items-center space-x-2">
            <MessageSquare class="w-4 h-4 text-gray-400" />
            <span class="font-medium text-gray-900 truncate">
              {{ conv.title || '新会话' }}
            </span>
          </div>
          <p class="text-sm text-gray-500 truncate mt-1">
            {{ conv.messageCount ? `${conv.messageCount} 条消息` : '暂无消息' }}
          </p>
          <p class="text-xs text-gray-400 mt-1">
            {{ new Date(conv.updatedAt).toLocaleString() }}
          </p>
        </div>
        <button
          class="p-1 text-gray-400 hover:text-red-500 transition-colors"
          @click.stop="emit('delete', conv.id)"
        >
          <Trash2 class="w-4 h-4" />
        </button>
      </div>

      <div v-if="conversations.length === 0" class="p-8 text-center text-gray-500">
        <MessageSquare class="w-12 h-12 mx-auto mb-4 text-gray-300" />
        <p>暂无会话</p>
        <p class="text-sm">点击上方按钮开始新会话</p>
      </div>
    </div>
  </div>
</template>
