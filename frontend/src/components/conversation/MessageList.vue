<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { MessageSquare, Play } from 'lucide-vue-next';
import MarkdownIt from 'markdown-it';
import type { Message } from '@/types';

const props = defineProps<{
  messages: Message[];
  isLoading: boolean;
}>();

const md = new MarkdownIt();
const containerRef = ref<HTMLElement | null>(null);

const scrollToBottom = async (): Promise<void> => {
  await nextTick();
  if (containerRef.value) {
    containerRef.value.scrollTop = containerRef.value.scrollHeight;
  }
};

watch(
  () => props.messages.length,
  () => {
    void scrollToBottom();
  },
);

watch(
  () => props.messages[props.messages.length - 1]?.content,
  () => {
    void scrollToBottom();
  },
);

const speakText = (text: string): void => {
  if ('speechSynthesis' in window) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    speechSynthesis.speak(utterance);
  }
};
</script>

<template>
  <div ref="containerRef" class="flex-1 overflow-y-auto p-6">
    <div class="max-w-3xl mx-auto space-y-6">
      <div
        v-for="(msg, index) in messages"
        :key="msg.id || index"
        :class="['flex', msg.role === 'user' ? 'justify-end' : 'justify-start']"
      >
        <div
          :class="[
            'max-w-[70%] p-4 rounded-xl',
            msg.role === 'user'
              ? 'bg-blue-600 text-white rounded-br-none'
              : 'bg-gray-100 text-gray-900 rounded-bl-none',
          ]"
        >
          <div v-if="msg.role === 'assistant'" class="flex items-center justify-between mb-2">
            <span class="text-sm font-medium text-gray-500">AI 助手</span>
            <button
              class="p-1 hover:bg-gray-200 rounded transition-colors"
              @click="speakText(msg.content)"
            >
              <Play class="w-4 h-4 text-gray-500" />
            </button>
          </div>
          <div v-if="msg.role === 'user'" class="text-sm font-medium text-blue-100 mb-2">用户</div>
          <div
            v-if="msg.role === 'assistant'"
            class="prose prose-sm max-w-none"
            v-html="md.render(msg.content)"
          ></div>
          <p v-else class="whitespace-pre-wrap">{{ msg.content }}</p>
        </div>
      </div>

      <div v-if="isLoading" class="flex justify-start">
        <div class="bg-gray-100 p-4 rounded-xl rounded-bl-none">
          <div class="flex space-x-2">
            <span
              class="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
              style="animation-delay: 0ms"
            ></span>
            <span
              class="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
              style="animation-delay: 150ms"
            ></span>
            <span
              class="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
              style="animation-delay: 300ms"
            ></span>
          </div>
        </div>
      </div>

      <div
        v-if="messages.length === 0"
        class="flex flex-col items-center justify-center h-full text-gray-400"
      >
        <MessageSquare class="w-16 h-16 mb-4 text-gray-200" />
        <p class="text-lg">开始对话</p>
        <p class="text-sm">输入消息或使用语音输入与 AI 助手交流</p>
      </div>
    </div>
  </div>
</template>
