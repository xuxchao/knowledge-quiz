import { ref } from 'vue';
import http from '@/core/http';
import type { Document, Chunk, ApiResponse, TabType } from '@/types';

interface UploadResponse {
  success: boolean;
  data: {
    documentId: string;
    jobId: string;
    status: Document['status'];
  };
}

export function useDocument() {
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
  const uploadFile = ref<File | null>(null);
  const urlInput = ref('');

  const fetchDocuments = async (page: number = 1, search: string = ''): Promise<void> => {
    try {
      const response = await http.get<ApiResponse<Document[]>>('/api/documents', {
        params: {
          page,
          limit: 10,
          ...(search && { name: search }),
        },
      });
      documents.value = response.data.data || [];
      totalPages.value = response.data.pagination?.pages || 1;
      currentPage.value = page;
    } catch (error) {
      console.error('Failed to fetch documents:', error);
    }
  };

  const fetchChunks = async (documentId: string, page: number = 1): Promise<void> => {
    try {
      const response = await http.get<ApiResponse<Chunk[]>>('/api/chunks', {
        params: {
          documentId,
          page,
          limit: 10,
        },
      });
      chunks.value = response.data.data || [];
    } catch (error) {
      console.error('Failed to fetch chunks:', error);
    }
  };

  const deleteDocument = async (documentId: string): Promise<void> => {
    if (!confirm('确定要删除这个文件吗？')) return;
    try {
      await http.delete(`/api/documents/${documentId}`);
      await fetchDocuments(currentPage.value, searchQuery.value);
      if (selectedDocument.value?.id === documentId) {
        selectedDocument.value = null;
        chunks.value = [];
      }
    } catch (error) {
      console.error('Failed to delete document:', error);
    }
  };

  const viewChunks = (document: Document): void => {
    selectedDocument.value = document;
    activeTab.value = 'chunks';
    void fetchChunks(document.id);
  };

  const editChunk = (chunk: Chunk): void => {
    editingChunkId.value = chunk.id;
    editingChunkContent.value = chunk.content;
  };

  const saveChunk = async (chunkId: string): Promise<void> => {
    try {
      await http.put(`/api/chunks/${chunkId}`, {
        content: editingChunkContent.value,
      });
      editingChunkId.value = null;
      editingChunkContent.value = '';
      if (selectedDocument.value) {
        void fetchChunks(selectedDocument.value.id);
      }
    } catch (error) {
      console.error('Failed to update chunk:', error);
    }
  };

  const deleteChunk = async (chunkId: string): Promise<void> => {
    if (!confirm('确定要删除这个切片吗？')) return;
    try {
      await http.delete(`/api/chunks/${chunkId}`);
      if (selectedDocument.value) {
        void fetchChunks(selectedDocument.value.id);
      }
    } catch (error) {
      console.error('Failed to delete chunk:', error);
    }
  };

  const handleFileUpload = async (): Promise<void> => {
    if (!uploadFile.value) return;

    isUploading.value = true;

    try {
      const formData = new FormData();
      formData.append('file', uploadFile.value);

      const response = await http.post<UploadResponse>('/api/documents', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      if (response.data.success) {
        alert('文件已提交，正在后台处理');
        uploadFile.value = null;
        activeTab.value = 'files';
        void fetchDocuments();
      } else {
        alert('文件上传失败');
      }
    } catch (error) {
      console.error('Failed to upload file:', error);
      alert('文件上传失败');
    } finally {
      isUploading.value = false;
    }
  };

  const handleUrlUpload = async (): Promise<void> => {
    if (!urlInput.value.trim()) return;

    isUploading.value = true;

    try {
      const response = await http.post<UploadResponse>('/api/documents', {
        url: urlInput.value.trim(),
      });

      if (response.data.success) {
        alert('URL 已提交，正在后台处理');
        urlInput.value = '';
        activeTab.value = 'files';
        void fetchDocuments();
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

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const formatStatus = (status: string): string => {
    const statusMap: Record<string, string> = {
      uploading: '上传中',
      processing: '处理中',
      processed: '已处理',
      completed: '已完成',
      failed: '失败',
    };
    return statusMap[status] || status;
  };

  return {
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
  };
}
