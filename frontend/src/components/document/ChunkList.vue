<script setup lang="ts">
import { ref, watch } from 'vue';
import { X, Edit2, Trash2, FileText } from 'lucide-vue-next';
import type { Document, Chunk } from '@/types';

const props = defineProps<{
  document: Document;
  chunks: Chunk[];
  editingChunkId: string | null;
  editingChunkContent: string;
}>();

const emit = defineEmits<{
  back: [];
  edit: [chunk: Chunk];
  save: [chunkId: string];
  cancel: [];
  delete: [chunkId: string];
  'update:editingChunkContent': [value: string];
}>();

const localContent = ref(props.editingChunkContent);

watch(
  () => props.editingChunkContent,
  (newValue) => {
    localContent.value = newValue;
  },
);

const handleInput = (event: Event): void => {
  const target = event.target as HTMLTextAreaElement;
  localContent.value = target.value;
  emit('update:editingChunkContent', target.value);
};
</script>

<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-4">
      <div>
        <h2 class="text-lg font-semibold text-gray-900">{{ document.name }}</h2>
        <p class="text-sm text-gray-500">共 {{ document.chunkCount }} 个切片</p>
      </div>
      <button
        class="flex items-center space-x-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        @click="emit('back')"
      >
        <X class="w-4 h-4" />
        <span>返回</span>
      </button>
    </div>

    <div class="space-y-4">
      <div v-for="chunk in chunks" :key="chunk.id" class="border border-gray-200 rounded-lg p-4">
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm font-medium text-gray-700">
            切片 {{ chunk.chunkIndex + 1 }} / {{ document.chunkCount }}
          </span>
          <div class="flex space-x-2">
            <button
              class="p-1 text-gray-500 hover:text-blue-600 transition-colors"
              @click="emit('edit', chunk)"
            >
              <Edit2 class="w-4 h-4" />
            </button>
            <button
              class="p-1 text-gray-500 hover:text-red-600 transition-colors"
              @click="emit('delete', chunk.id)"
            >
              <Trash2 class="w-4 h-4" />
            </button>
          </div>
        </div>

        <div v-if="editingChunkId === chunk.id" class="mb-2">
          <textarea
            :value="localContent"
            class="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none h-32"
            @input="handleInput"
          ></textarea>
          <div class="flex space-x-2 mt-2">
            <button
              class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              @click="emit('save', chunk.id)"
            >
              保存
            </button>
            <button
              class="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              @click="emit('cancel')"
            >
              取消
            </button>
          </div>
        </div>

        <p v-else class="text-sm text-gray-600 whitespace-pre-wrap max-h-32 overflow-y-auto">
          {{ chunk.content }}
        </p>
      </div>

      <div v-if="chunks.length === 0" class="text-center py-8 text-gray-500">
        <FileText class="w-12 h-12 mx-auto mb-4 text-gray-300" />
        <p>暂无切片数据</p>
      </div>
    </div>
  </div>
</template>
