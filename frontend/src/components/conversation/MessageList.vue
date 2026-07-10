<script setup lang="ts">
import { nextTick, useTemplateRef, watch } from 'vue';
import { Download, FileText, LoaderCircle, MessageSquare, Pause, Play } from 'lucide-vue-next';
import MarkdownIt from 'markdown-it';
import { useSpeechSynthesis } from '@/composables/useSpeechSynthesis';
import { baseURL } from '@/core/http';
import type { Message } from '@/types';

const props = defineProps<{
  messages: Message[];
  isLoading: boolean;
  isConversationLoading: boolean;
}>();

const md = new MarkdownIt({ html: false });

function getDownloadUrl(downloadUrl: string): string {
  return /^https?:\/\//i.test(downloadUrl) ? downloadUrl : `${baseURL}${downloadUrl}`;
}
const containerRef = useTemplateRef<HTMLElement>('messageContainer');
const {
  isSupported: isSpeechSupported,
  toggle: toggleSpeech,
  isPlaying,
  buttonLabel,
} = useSpeechSynthesis();

const messageKey = (message: Message, index: number): string => message.id || `message-${index}`;

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
</script>

<template>
  <div ref="messageContainer" class="flex-1 overflow-y-auto p-6">
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
              v-if="isSpeechSupported"
              class="p-1 hover:bg-gray-200 rounded transition-colors"
              :aria-label="buttonLabel(messageKey(msg, index))"
              :title="buttonLabel(messageKey(msg, index))"
              @click="toggleSpeech(messageKey(msg, index), msg.content)"
            >
              <Pause v-if="isPlaying(messageKey(msg, index))" class="w-4 h-4 text-gray-500" />
              <Play v-else class="w-4 h-4 text-gray-500" />
            </button>
          </div>
          <div v-if="msg.role === 'user'" class="text-sm font-medium text-blue-100 mb-2">用户</div>
          <!-- eslint-disable vue/no-v-html -->
          <div
            v-if="msg.role === 'assistant'"
            class="prose prose-sm max-w-none"
            v-html="md.render(msg.content)"
          ></div>
          <!-- eslint-enable vue/no-v-html -->
          <p v-else class="whitespace-pre-wrap">{{ msg.content }}</p>

          <div
            v-if="msg.role === 'assistant' && msg.references?.length"
            class="mt-4 pt-3 border-t border-gray-300"
          >
            <div class="flex items-center gap-2 text-sm font-medium text-gray-600 mb-2">
              <FileText class="w-4 h-4" />
              <span>引用文档</span>
            </div>
            <details
              v-for="reference in msg.references"
              :key="`${reference.documentId}-${reference.chunkIndex}`"
              class="py-2 border-t border-gray-200 first:border-t-0"
            >
              <summary class="cursor-pointer text-sm text-gray-700">
                <span>{{ reference.documentName }} · 片段 {{ reference.chunkIndex + 1 }}</span>
              </summary>
              <a
                class="mt-2 inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 hover:underline"
                :href="getDownloadUrl(reference.downloadUrl)"
                :download="reference.documentName"
                :aria-label="`下载引用文档 ${reference.documentName}`"
              >
                <Download class="h-4 w-4" />
                <span>下载原始文档</span>
              </a>
              <p class="mt-2 text-sm leading-6 text-gray-600 whitespace-pre-wrap">
                {{ reference.content }}
              </p>
            </details>
          </div>
        </div>
      </div>

      <div
        v-if="isConversationLoading"
        class="flex items-center justify-center gap-2 py-8 text-gray-500"
      >
        <LoaderCircle class="w-5 h-5 animate-spin" />
        <span>正在加载消息</span>
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
        v-if="messages.length === 0 && !isConversationLoading"
        class="flex flex-col items-center justify-center h-full text-gray-400"
      >
        <MessageSquare class="w-16 h-16 mb-4 text-gray-200" />
        <p class="text-lg">开始对话</p>
        <p class="text-sm">输入消息或使用语音输入与 AI 助手交流</p>
      </div>
    </div>
  </div>
</template>
