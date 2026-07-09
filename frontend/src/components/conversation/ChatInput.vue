<script setup lang="ts">
import { ref } from 'vue';
import { Mic, Send } from 'lucide-vue-next';

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface SpeechRecognitionResult {
  readonly 0: SpeechRecognitionAlternative;
  readonly isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  readonly 0: SpeechRecognitionResult;
}

interface SpeechRecognitionInterface {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((this: SpeechRecognitionInterface, ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((this: SpeechRecognitionInterface, ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInterface;
    webkitSpeechRecognition?: new () => SpeechRecognitionInterface;
  }
}

defineProps<{
  disabled: boolean;
}>();

const emit = defineEmits<{
  send: [message: string];
}>();

const inputMessage = ref('');
const isRecording = ref(false);

const handleSend = (): void => {
  if (!inputMessage.value.trim()) return;
  emit('send', inputMessage.value.trim());
  inputMessage.value = '';
};

const handleKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    handleSend();
  }
};

const startRecording = (): void => {
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    alert('您的浏览器不支持语音识别功能');
    return;
  }
  isRecording.value = true;
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognitionCtor) {
    alert('您的浏览器不支持语音识别功能');
    isRecording.value = false;
    return;
  }
  const recognition = new SpeechRecognitionCtor();
  recognition.lang = 'zh-CN';
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.onresult = (event: SpeechRecognitionEvent) => {
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
</script>

<template>
  <div class="border-t border-gray-200 p-4">
    <div class="max-w-3xl mx-auto flex items-end space-x-3">
      <button
        :class="[
          'p-3 rounded-lg transition-colors',
          isRecording ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
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
          :disabled="disabled"
          @keydown="handleKeydown"
        ></textarea>
      </div>
      <button
        :disabled="!inputMessage.trim() || disabled"
        :class="[
          'p-3 rounded-lg transition-colors',
          inputMessage.trim() && !disabled
            ? 'bg-blue-600 text-white hover:bg-blue-700'
            : 'bg-gray-200 text-gray-400 cursor-not-allowed',
        ]"
        @click="handleSend"
      >
        <Send class="w-5 h-5" />
      </button>
    </div>
  </div>
</template>
