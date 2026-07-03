<script setup lang="ts">
import { Upload } from 'lucide-vue-next';

defineProps<{
  isUploading: boolean;
  uploadFile: File | null;
  urlInput: string;
  formatFileSize: (bytes: number) => string;
}>();

const emit = defineEmits<{
  selectFile: [];
  setUploadFile: [file: File | null];
  uploadFile: [];
  setUrlInput: [value: string];
  uploadUrl: [];
}>();
</script>

<template>
  <div class="p-6">
    <div class="max-w-2xl mx-auto">
      <h2 class="text-lg font-semibold text-gray-900 mb-4">上传文件</h2>

      <div class="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center mb-6">
        <Upload class="w-12 h-12 mx-auto mb-4 text-gray-400" />
        <p class="text-gray-600 mb-2">点击或拖拽文件到此处上传</p>
        <p class="text-sm text-gray-400">
          支持 PDF、DOCX、XLSX、PPTX、TXT、MD、JSON、图片、音频、视频
        </p>
        <input
          id="file-upload"
          type="file"
          class="hidden"
          accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.pptx,.ppt,.txt,.md,.json,.jpg,.jpeg,.png,.gif,.webp,.mp3,.wav,.m4a,.mp4"
          @change="emit('setUploadFile', ($event.target as HTMLInputElement).files?.[0] || null)"
        />
        <button
          class="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          @click="emit('selectFile')"
        >
          选择文件
        </button>
      </div>

      <div v-if="uploadFile" class="mb-6 p-4 bg-gray-50 rounded-lg">
        <div class="flex items-center justify-between mb-2">
          <span class="font-medium">{{ uploadFile.name }}</span>
          <span class="text-sm text-gray-500">{{ formatFileSize(uploadFile.size) }}</span>
        </div>
        <div class="w-full bg-gray-200 rounded-full h-2">
          <div
            class="bg-blue-600 h-2 rounded-full transition-all"
            :style="{ width: isUploading ? '50%' : '0%' }"
          ></div>
        </div>
      </div>

      <button
        :disabled="!uploadFile || isUploading"
        :class="[
          'w-full py-3 rounded-lg font-medium transition-colors',
          uploadFile && !isUploading
            ? 'bg-blue-600 text-white hover:bg-blue-700'
            : 'bg-gray-200 text-gray-400 cursor-not-allowed',
        ]"
        @click="emit('uploadFile')"
      >
        {{ isUploading ? '上传中...' : '上传文件' }}
      </button>

      <div class="mt-8 pt-8 border-t border-gray-200">
        <h3 class="text-lg font-semibold text-gray-900 mb-4">URL 地址处理</h3>
        <div class="flex space-x-3">
          <input
            :value="urlInput"
            placeholder="输入 URL 地址..."
            class="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            @input="emit('setUrlInput', ($event.target as HTMLInputElement).value)"
          />
          <button
            :disabled="!urlInput.trim() || isUploading"
            :class="[
              'px-6 py-2 rounded-lg font-medium transition-colors',
              urlInput.trim() && !isUploading
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed',
            ]"
            @click="emit('uploadUrl')"
          >
            {{ isUploading ? '处理中...' : '处理 URL' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
