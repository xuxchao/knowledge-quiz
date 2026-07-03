<script setup lang="ts">
import { Search, Plus, Eye, Trash2, FileText } from 'lucide-vue-next';
import type { Document } from '@/types';

defineProps<{
  documents: Document[];
  searchQuery: string;
  currentPage: number;
  totalPages: number;
  formatFileSize: (bytes: number) => string;
  formatStatus: (status: string) => string;
}>();

const emit = defineEmits<{
  search: [query: string];
  upload: [];
  viewChunks: [document: Document];
  delete: [documentId: string];
  pageChange: [page: number];
}>();
</script>

<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-4">
      <div class="relative">
        <Search class="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input
          :value="searchQuery"
          placeholder="搜索文件名..."
          class="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
          @keyup.enter="emit('search', ($event.target as HTMLInputElement).value)"
        />
        <button
          class="ml-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          @click="emit('search', searchQuery)"
        >
          搜索
        </button>
      </div>
      <button
        class="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        @click="emit('upload')"
      >
        <Plus class="w-4 h-4" />
        <span>上传文件</span>
      </button>
    </div>

    <div class="overflow-x-auto">
      <table class="w-full">
        <thead>
          <tr class="bg-gray-50">
            <th class="px-4 py-3 text-left text-sm font-medium text-gray-700">文件名</th>
            <th class="px-4 py-3 text-left text-sm font-medium text-gray-700">类型</th>
            <th class="px-4 py-3 text-left text-sm font-medium text-gray-700">状态</th>
            <th class="px-4 py-3 text-left text-sm font-medium text-gray-700">切片数</th>
            <th class="px-4 py-3 text-left text-sm font-medium text-gray-700">大小</th>
            <th class="px-4 py-3 text-left text-sm font-medium text-gray-700">创建时间</th>
            <th class="px-4 py-3 text-left text-sm font-medium text-gray-700">操作</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200">
          <tr v-for="doc in documents" :key="doc.id">
            <td class="px-4 py-3">
              <div class="flex items-center space-x-2">
                <FileText class="w-5 h-5 text-gray-400" />
                <span class="font-medium text-gray-900">{{ doc.name }}</span>
              </div>
            </td>
            <td class="px-4 py-3 text-sm text-gray-600">{{ doc.type }}</td>
            <td class="px-4 py-3">
              <span
                :class="[
                  'px-2 py-1 text-xs font-medium rounded-full',
                  doc.status === 'PROCESSED'
                    ? 'bg-green-100 text-green-800'
                    : doc.status === 'PROCESSING'
                      ? 'bg-yellow-100 text-yellow-800'
                      : doc.status === 'FAILED'
                        ? 'bg-red-100 text-red-800'
                        : 'bg-blue-100 text-blue-800',
                ]"
              >
                {{ formatStatus(doc.status) }}
              </span>
            </td>
            <td class="px-4 py-3 text-sm text-gray-600">{{ doc.chunkCount }}</td>
            <td class="px-4 py-3 text-sm text-gray-600">{{ formatFileSize(doc.fileSize) }}</td>
            <td class="px-4 py-3 text-sm text-gray-600">
              {{ new Date(doc.createdAt).toLocaleString() }}
            </td>
            <td class="px-4 py-3">
              <div class="flex space-x-2">
                <button
                  class="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                  title="查看切片"
                  @click="emit('viewChunks', doc)"
                >
                  <Eye class="w-4 h-4" />
                </button>
                <button
                  class="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  title="删除"
                  @click="emit('delete', doc.id)"
                >
                  <Trash2 class="w-4 h-4" />
                </button>
              </div>
            </td>
          </tr>
          <tr v-if="documents.length === 0">
            <td colspan="7" class="px-4 py-8 text-center text-gray-500">
              <FileText class="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p>暂无文件</p>
              <button class="mt-2 text-blue-600 hover:text-blue-700" @click="emit('upload')">
                上传文件
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="totalPages > 1" class="flex items-center justify-between mt-4">
      <button
        :disabled="currentPage === 1"
        class="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        @click="emit('pageChange', currentPage - 1)"
      >
        上一页
      </button>
      <span class="text-sm text-gray-600">第 {{ currentPage }} / {{ totalPages }} 页</span>
      <button
        :disabled="currentPage === totalPages"
        class="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        @click="emit('pageChange', currentPage + 1)"
      >
        下一页
      </button>
    </div>
  </div>
</template>
