<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Upload, FileText, List, Search, Trash2, Eye, Edit2, X, Plus, Download } from 'lucide-vue-next';

interface Document {
  id: string;
  name: string;
  type: string;
  status: string;
  chunkCount: number;
  fileSize: number;
  createdAt: Date;
  updatedAt: Date;
}

interface Chunk {
  id: string;
  content: string;
  chunkIndex: number;
  totalChunks: number;
  createdAt: Date;
}

type TabType = 'files' | 'upload' | 'chunks';

const activeTab = ref<TabType>('files');
const documents = ref<Document[]>([]);
const chunks = ref<Chunk[]>([]);
const searchQuery = ref('');
const currentPage = ref(1);
const totalPages = ref(1);
const selectedDocument = ref<Document | null>(null);
const editingChunkId = ref<string | null>(null);
const editingChunkContent = ref('');
const isUploading = ref(false);
const uploadProgress = ref(0);
const uploadFile = ref<File | null>(null);
const urlInput = ref('');

const fetchDocuments = async (page: number = 1, search: string = '') => {
  try {
    const response = await fetch(`/api/documents?page=${page}&limit=10${search ? `&name=${encodeURIComponent(search)}` : ''}`);
    const data = await response.json();
    documents.value = data.data || [];
    totalPages.value = data.pagination?.pages || 1;
    currentPage.value = page;
  } catch (error) {
    console.error('Failed to fetch documents:', error);
  }
};

const fetchChunks = async (documentId: string, page: number = 1) => {
  try {
    const response = await fetch(`/api/chunks?documentId=${documentId}&page=${page}&limit=10`);
    const data = await response.json();
    chunks.value = data.data || [];
  } catch (error) {
    console.error('Failed to fetch chunks:', error);
  }
};

const deleteDocument = async (documentId: string) => {
  if (!confirm('确定要删除这个文件吗？')) return;
  try {
    await fetch(`/api/documents/${documentId}`, {
      method: 'DELETE',
    });
    await fetchDocuments(currentPage.value, searchQuery.value);
  } catch (error) {
    console.error('Failed to delete document:', error);
  }
};

const viewChunks = (document: Document) => {
  selectedDocument.value = document;
  activeTab.value = 'chunks';
  fetchChunks(document.id);
};

const editChunk = (chunk: Chunk) => {
  editingChunkId.value = chunk.id;
  editingChunkContent.value = chunk.content;
};

const saveChunk = async (chunkId: string) => {
  try {
    await fetch(`/api/chunks/${chunkId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content: editingChunkContent.value }),
    });
    editingChunkId.value = null;
    editingChunkContent.value = '';
    if (selectedDocument.value) {
      fetchChunks(selectedDocument.value.id);
    }
  } catch (error) {
    console.error('Failed to update chunk:', error);
  }
};

const deleteChunk = async (chunkId: string) => {
  if (!confirm('确定要删除这个切片吗？')) return;
  try {
    await fetch(`/api/chunks/${chunkId}`, {
      method: 'DELETE',
    });
    if (selectedDocument.value) {
      fetchChunks(selectedDocument.value.id);
    }
  } catch (error) {
    console.error('Failed to delete chunk:', error);
  }
};

const handleFileUpload = async () => {
  if (!uploadFile.value) return;
  
  isUploading.value = true;
  uploadProgress.value = 0;
  
  try {
    const formData = new FormData();
    formData.append('file', uploadFile.value);
    
    const response = await fetch('/api/documents', {
      method: 'POST',
      body: formData,
    });
    
    const data = await response.json();
    if (data.success) {
      alert('文件上传成功');
      uploadFile.value = null;
      activeTab.value = 'files';
      fetchDocuments();
    } else {
      alert('文件上传失败');
    }
  } catch (error) {
    console.error('Failed to upload file:', error);
    alert('文件上传失败');
  } finally {
    isUploading.value = false;
    uploadProgress.value = 0;
  }
};

const handleUrlUpload = async () => {
  if (!urlInput.value.trim()) return;
  
  isUploading.value = true;
  
  try {
    const response = await fetch('/api/documents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: urlInput.value.trim() }),
    });
    
    const data = await response.json();
    if (data.success) {
      alert('URL 处理成功');
      urlInput.value = '';
      activeTab.value = 'files';
      fetchDocuments();
    } else {
      alert('URL 处理失败');
    }
  } catch (error) {
    console.error('Failed to process URL:', error);
    alert('URL 处理失败');
  } finally {
    isUploading.value = false;
  }
};

const formatFileSize = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const formatStatus = (status: string) => {
  const statusMap: Record<string, string> = {
    UPLOADING: '上传中',
    PROCESSING: '处理中',
    PROCESSED: '已处理',
    FAILED: '失败',
  };
  return statusMap[status] || status;
};

onMounted(() => {
  fetchDocuments();
});
</script>

<template>
  <div class="bg-white rounded-lg shadow-lg overflow-hidden">
    <div class="border-b border-gray-200">
      <nav class="flex space-x-1 p-1 bg-gray-50">
        <button
          @click="activeTab = 'files'; selectedDocument = null"
          :class="[
            'flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors',
            activeTab === 'files'
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-gray-600 hover:bg-gray-100'
          ]"
        >
          <List class="w-4 h-4" />
          <span>文件列表</span>
        </button>
        <button
          @click="activeTab = 'upload'"
          :class="[
            'flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors',
            activeTab === 'upload'
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-gray-600 hover:bg-gray-100'
          ]"
        >
          <Upload class="w-4 h-4" />
          <span>上传文件</span>
        </button>
        <button
          v-if="selectedDocument"
          @click="activeTab = 'chunks'; fetchChunks(selectedDocument.id)"
          :class="[
            'flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors',
            activeTab === 'chunks'
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-gray-600 hover:bg-gray-100'
          ]"
        >
          <FileText class="w-4 h-4" />
          <span>切片详情</span>
        </button>
      </nav>
    </div>
    
    <div v-if="activeTab === 'files'" class="p-6">
      <div class="flex items-center justify-between mb-4">
        <div class="relative">
          <Search class="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            v-model="searchQuery"
            @keyup.enter="fetchDocuments(1, searchQuery)"
            placeholder="搜索文件名..."
            class="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
          />
          <button
            @click="fetchDocuments(1, searchQuery)"
            class="ml-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            搜索
          </button>
        </div>
        <button
          @click="activeTab = 'upload'"
          class="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
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
                    doc.status === 'PROCESSED' ? 'bg-green-100 text-green-800' :
                    doc.status === 'PROCESSING' ? 'bg-yellow-100 text-yellow-800' :
                    doc.status === 'FAILED' ? 'bg-red-100 text-red-800' :
                    'bg-blue-100 text-blue-800'
                  ]"
                >
                  {{ formatStatus(doc.status) }}
                </span>
              </td>
              <td class="px-4 py-3 text-sm text-gray-600">{{ doc.chunkCount }}</td>
              <td class="px-4 py-3 text-sm text-gray-600">{{ formatFileSize(doc.fileSize) }}</td>
              <td class="px-4 py-3 text-sm text-gray-600">{{ new Date(doc.createdAt).toLocaleString() }}</td>
              <td class="px-4 py-3">
                <div class="flex space-x-2">
                  <button
                    @click="viewChunks(doc)"
                    class="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    title="查看切片"
                  >
                    <Eye class="w-4 h-4" />
                  </button>
                  <button
                    @click="deleteDocument(doc.id)"
                    class="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="删除"
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
                <button
                  @click="activeTab = 'upload'"
                  class="mt-2 text-blue-600 hover:text-blue-700"
                >
                  上传文件
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      
      <div v-if="totalPages > 1" class="flex items-center justify-between mt-4">
        <button
          @click="fetchDocuments(currentPage - 1, searchQuery)"
          :disabled="currentPage === 1"
          class="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          上一页
        </button>
        <span class="text-sm text-gray-600">第 {{ currentPage }} / {{ totalPages }} 页</span>
        <button
          @click="fetchDocuments(currentPage + 1, searchQuery)"
          :disabled="currentPage === totalPages"
          class="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          下一页
        </button>
      </div>
    </div>
    
    <div v-if="activeTab === 'upload'" class="p-6">
      <div class="max-w-2xl mx-auto">
        <h2 class="text-lg font-semibold text-gray-900 mb-4">上传文件</h2>
        
        <div class="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center mb-6">
          <Upload class="w-12 h-12 mx-auto mb-4 text-gray-400" />
          <p class="text-gray-600 mb-2">点击或拖拽文件到此处上传</p>
          <p class="text-sm text-gray-400">支持 PDF、DOCX、XLSX、PPTX、TXT、MD、JSON、图片、音频、视频</p>
          <input
            type="file"
            @change="uploadFile = ($event.target as HTMLInputElement).files?.[0] || null"
            class="hidden"
            id="file-upload"
            accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.pptx,.ppt,.txt,.md,.json,.jpg,.jpeg,.png,.gif,.webp,.mp3,.wav,.m4a,.mp4"
          />
          <button
            @click="($refs.fileInput as HTMLInputElement)?.click()"
            ref="fileInput"
            class="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
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
              :style="{ width: `${uploadProgress}%` }"
            ></div>
          </div>
        </div>
        
        <button
          @click="handleFileUpload"
          :disabled="!uploadFile || isUploading"
          :class="[
            'w-full py-3 rounded-lg font-medium transition-colors',
            (uploadFile && !isUploading)
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          ]"
        >
          {{ isUploading ? '上传中...' : '上传文件' }}
        </button>
        
        <div class="mt-8 pt-8 border-t border-gray-200">
          <h3 class="text-lg font-semibold text-gray-900 mb-4">URL 地址处理</h3>
          <div class="flex space-x-3">
            <input
              v-model="urlInput"
              placeholder="输入 URL 地址..."
              class="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              @click="handleUrlUpload"
              :disabled="!urlInput.trim() || isUploading"
              :class="[
                'px-6 py-2 rounded-lg font-medium transition-colors',
                (urlInput.trim() && !isUploading)
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              ]"
            >
              {{ isUploading ? '处理中...' : '处理 URL' }}
            </button>
          </div>
        </div>
      </div>
    </div>
    
    <div v-if="activeTab === 'chunks' && selectedDocument" class="p-6">
      <div class="flex items-center justify-between mb-4">
        <div>
          <h2 class="text-lg font-semibold text-gray-900">{{ selectedDocument.name }}</h2>
          <p class="text-sm text-gray-500">共 {{ selectedDocument.chunkCount }} 个切片</p>
        </div>
        <button
          @click="activeTab = 'files'; selectedDocument = null"
          class="flex items-center space-x-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <X class="w-4 h-4" />
          <span>返回</span>
        </button>
      </div>
      
      <div class="space-y-4">
        <div
          v-for="chunk in chunks"
          :key="chunk.id"
          class="border border-gray-200 rounded-lg p-4"
        >
          <div class="flex items-center justify-between mb-2">
            <span class="text-sm font-medium text-gray-700">
              切片 {{ chunk.chunkIndex + 1 }} / {{ chunk.totalChunks }}
            </span>
            <div class="flex space-x-2">
              <button
                @click="editChunk(chunk)"
                class="p-1 text-gray-500 hover:text-blue-600 transition-colors"
              >
                <Edit2 class="w-4 h-4" />
              </button>
              <button
                @click="deleteChunk(chunk.id)"
                class="p-1 text-gray-500 hover:text-red-600 transition-colors"
              >
                <Trash2 class="w-4 h-4" />
              </button>
            </div>
          </div>
          
          <div v-if="editingChunkId === chunk.id" class="mb-2">
            <textarea
              v-model="editingChunkContent"
              class="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none h-32"
            ></textarea>
            <div class="flex space-x-2 mt-2">
              <button
                @click="saveChunk(chunk.id)"
                class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                保存
              </button>
              <button
                @click="editingChunkId = null; editingChunkContent = ''"
                class="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
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
  </div>
  
  <input type="file" id="file-upload" class="hidden" />
</template>
