<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Plus, MessageSquare, Mic, Send, Play, Trash2 } from 'lucide-vue-next';
import MarkdownIt from 'markdown-it';
import http, { baseURL } from '@/core/http';
const md = new MarkdownIt();
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
}
interface Conversation {
  id: string;
  userId: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
}
const conversations = ref<Conversation[]>([]);
const currentConversation = ref<Conversation | null>(null);
const messages = ref<Message[]>([]);
const inputMessage = ref('');
const isLoading = ref(false);
const isRecording = ref(false);
const audioRef = ref<HTMLAudioElement | null>(null);
const fetchConversations = async () => {
  try {
    const response = await http.get(`/api/conversations`);
    conversations.value = response.data.data || [];
    if (conversations.value.length > 0) {
      selectConversation(conversations.value[0]);
    }
  } catch (error) {
    console.error('Failed to fetch conversations:', error);
  }
};
const selectConversation = (conversation: Conversation) => {
  currentConversation.value = conversation;
  messages.value = conversation.messages || [];
};
const createNewConversation = async () => {
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
const sendMessage = () => {
  if (!inputMessage.value.trim() || isLoading.value) return;
  const messageText = inputMessage.value.trim();
  inputMessage.value = '';
  const userMessage: Message = {
    id: `${Date.now()}`,
    role: 'user',
    content: messageText,
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
    message: messageText,
    userId: 'default',
  });

  if (currentConversation.value?.id) {
    params.set('conversationId', currentConversation.value.id);
  }

  const eventSource = new EventSource(`${baseURL}/api/conversations/chat?${params.toString()}`);

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'message') {
        assistantMessage.content += data.content;
        if (!currentConversation.value?.id) {
          currentConversation.value = {
            ...currentConversation.value!,
            id: data.conversationId,
            userId: currentConversation.value?.userId || 'default',
          };
        }
      } else if (data.type === 'done') {
        if (!currentConversation.value?.id) {
          currentConversation.value = {
            ...currentConversation.value!,
            id: data.conversationId,
            userId: currentConversation.value?.userId || 'default',
          };
        }
        fetchConversations();
        eventSource.close();
        isLoading.value = false;
      }
    } catch (e) {
      console.error('Failed to parse SSE message:', e);
    }
  };

  eventSource.onerror = () => {
    console.error('SSE connection error');
    assistantMessage.content = '抱歉，服务器出错了，请稍后再试。';
    eventSource.close();
    isLoading.value = false;
  };

  eventSource.onopen = () => {
    console.log('SSE connection opened');
  };
};
const deleteConversation = async (conversationId: string) => {
  if (!confirm('确定要删除这个会话吗？')) return;
  try {
    await http.delete(`/api/conversations/${conversationId}`);
    await fetchConversations();
  } catch (error) {
    console.error('Failed to delete conversation:', error);
  }
};
const speakText = (text: string) => {
  if ('speechSynthesis' in window) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    speechSynthesis.speak(utterance);
  }
};
const startRecording = () => {
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    alert('您的浏览器不支持语音识别功能');
    return;
  }
  isRecording.value = true;
  const SpeechRecognition =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  const recognition = new SpeechRecognition();
  recognition.lang = 'zh-CN';
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.onresult = (event: any) => {
    const transcript = event.results[0][0].transcript;
    inputMessage.value = transcript;
  };
  recognition.onerror = () => {
    isRecording.value = false;
  };
  recognition.onend = () => {
    isRecording.value = false;
  };
  recognition.start();
};
onMounted(() => {
  fetchConversations();
});
</script>

<template>
  <div class="flex h-[calc(100vh-8rem)] bg-white rounded-lg shadow-lg overflow-hidden">
    <div class="w-72 border-r border-gray-200 flex flex-col">
      <div class="p-4 border-b border-gray-200">
        <button
          class="w-full flex items-center justify-center space-x-2 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors"
          @click="createNewConversation"
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
          @click="selectConversation(conv)"
        >
          <div class="flex-1 min-w-0">
            <div class="flex items-center space-x-2">
              <MessageSquare class="w-4 h-4 text-gray-400" />
              <span class="font-medium text-gray-900 truncate">
                {{ conv.messages?.[0]?.content || '新会话' }}
              </span>
            </div>
            <p class="text-sm text-gray-500 truncate mt-1">
              {{ conv.messages?.[conv.messages.length - 1]?.content || '暂无消息' }}
            </p>
            <p class="text-xs text-gray-400 mt-1">
              {{ new Date(conv.updatedAt).toLocaleString() }}
            </p>
          </div>
          <button
            class="p-1 text-gray-400 hover:text-red-500 transition-colors"
            @click.stop="deleteConversation(conv.id)"
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

    <div class="flex-1 flex flex-col">
      <div v-if="currentConversation" class="flex-1 overflow-y-auto p-6">
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
              <div v-if="msg.role === 'user'" class="text-sm font-medium text-blue-100 mb-2">
                用户
              </div>
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

      <div v-if="currentConversation" class="border-t border-gray-200 p-4">
        <div class="max-w-3xl mx-auto flex items-end space-x-3">
          <button
            :class="[
              'p-3 rounded-lg transition-colors',
              isRecording
                ? 'bg-red-100 text-red-600'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
            ]"
            @mousedown="startRecording"
            @mouseup="isRecording = false"
            @mouseleave="isRecording = false"
          >
            <Mic class="w-5 h-5" />
          </button>
          <div class="flex-1">
            <textarea
              v-model="inputMessage"
              placeholder="输入消息..."
              rows="1"
              class="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              @keydown.enter.exact.prevent="sendMessage"
            ></textarea>
          </div>
          <button
            :disabled="!inputMessage.trim() || isLoading"
            :class="[
              'p-3 rounded-lg transition-colors',
              inputMessage.trim() && !isLoading
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed',
            ]"
            @click="sendMessage"
          >
            <Send class="w-5 h-5" />
          </button>
        </div>
      </div>

      <div v-else class="flex-1 flex items-center justify-center text-gray-500">
        <MessageSquare class="w-16 h-16 mb-4 text-gray-300" />
        <p>选择或创建一个会话开始聊天</p>
      </div>
    </div>
  </div>

  <audio ref="audioRef" />
</template>
