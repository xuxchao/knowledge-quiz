export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
  references?: DocumentReference[];
}

export interface DocumentReference {
  documentId: string;
  documentName: string;
  downloadUrl: string;
  chunkIndex: number;
  content: string;
  score: number;
}

export interface Conversation {
  id: string;
  userId: string;
  title?: string;
  messageCount?: number;
  messages?: Message[];
  messagePage?: {
    nextCursor: string | null;
    hasMore: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface Document {
  id: string;
  name: string;
  type: string;
  status: 'uploading' | 'processing' | 'processed' | 'completed' | 'failed';
  chunkCount: number;
  fileSize: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Chunk {
  id: string;
  content: string;
  chunkIndex: number;
  createdAt: Date;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data: T;
  message?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export type TabType = 'files' | 'upload' | 'chunks';
