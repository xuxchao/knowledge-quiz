<script setup lang="ts">
import { onMounted } from 'vue';
import { List, Upload, FileText } from 'lucide-vue-next';
import DocumentList from '@/components/document/DocumentList.vue';
import FileUpload from '@/components/document/FileUpload.vue';
import ChunkList from '@/components/document/ChunkList.vue';
import { useDocument } from '@/composables/useDocument';

const {
  activeTab,
  documents,
  chunks,
  searchQuery,
  currentPage,
  totalPages,
  selectedDocument,
  editingChunkId,
  editingChunkContent,
  isUploading,
  uploadFile,
  urlInput,
  fetchDocuments,
  fetchChunks,
  deleteDocument,
  viewChunks,
  editChunk,
  saveChunk,
  deleteChunk,
  handleFileUpload,
  handleUrlUpload,
  formatFileSize,
  formatStatus,
} = useDocument();

onMounted(() => {
  void fetchDocuments();
});

const handleSearch = (query: string): void => {
  void fetchDocuments(1, query);
};

const handlePageChange = (page: number): void => {
  void fetchDocuments(page, searchQuery.value);
};

const triggerFileUpload = (): void => {
  const fileInput = globalThis.document.getElementById('file-upload') as HTMLInputElement;
  fileInput?.click();
};
</script>

<template>
  <div class="bg-white rounded-lg shadow-lg overflow-hidden">
    <div class="border-b border-gray-200">
      <nav class="flex space-x-1 p-1 bg-gray-50">
        <button
          :class="[
            'flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors',
            activeTab === 'files'
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-gray-600 hover:bg-gray-100',
          ]"
          @click="
            activeTab = 'files';
            selectedDocument = null;
          "
        >
          <List class="w-4 h-4" />
          <span>文件列表</span>
        </button>
        <button
          :class="[
            'flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors',
            activeTab === 'upload'
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-gray-600 hover:bg-gray-100',
          ]"
          @click="activeTab = 'upload'"
        >
          <Upload class="w-4 h-4" />
          <span>上传文件</span>
        </button>
        <button
          v-if="selectedDocument"
          :class="[
            'flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors',
            activeTab === 'chunks'
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-gray-600 hover:bg-gray-100',
          ]"
          @click="
            activeTab = 'chunks';
            void fetchChunks(selectedDocument.id);
          "
        >
          <FileText class="w-4 h-4" />
          <span>切片详情</span>
        </button>
      </nav>
    </div>

    <DocumentList
      v-if="activeTab === 'files'"
      :documents="documents"
      :search-query="searchQuery"
      :current-page="currentPage"
      :total-pages="totalPages"
      :format-file-size="formatFileSize"
      :format-status="formatStatus"
      @search="handleSearch"
      @upload="activeTab = 'upload'"
      @view-chunks="viewChunks"
      @delete="deleteDocument"
      @page-change="handlePageChange"
    />

    <FileUpload
      v-else-if="activeTab === 'upload'"
      :is-uploading="isUploading"
      :upload-file="uploadFile"
      :url-input="urlInput"
      :format-file-size="formatFileSize"
      @select-file="triggerFileUpload"
      @set-upload-file="(file) => (uploadFile = file)"
      @upload-file="handleFileUpload"
      @set-url-input="(value) => (urlInput = value)"
      @upload-url="handleUrlUpload"
    />

    <ChunkList
      v-else-if="activeTab === 'chunks' && selectedDocument"
      v-model:editing-chunk-content="editingChunkContent"
      :document="selectedDocument"
      :chunks="chunks"
      :editing-chunk-id="editingChunkId"
      @back="
        activeTab = 'files';
        selectedDocument = null;
      "
      @edit="editChunk"
      @save="saveChunk"
      @cancel="
        editingChunkId = null;
        editingChunkContent = '';
      "
      @delete="deleteChunk"
    />
  </div>

  <input id="file-upload" type="file" class="hidden" />
</template>
