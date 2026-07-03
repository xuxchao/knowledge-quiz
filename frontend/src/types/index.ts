export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
}

export interface Conversation {
  id: string;
  userId: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Document {
  id: string;
  name: string;
  type: string;
  status: string;
  chunkCount: number;
  fileSize: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Chunk {
  id: string;
  content: string;
  chunkIndex: number;
  totalChunks: number;
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
