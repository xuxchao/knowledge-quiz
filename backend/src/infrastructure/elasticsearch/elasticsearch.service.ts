import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@elastic/elasticsearch';
import { LoggerService, LogServiceCall } from '../../common/logger';

export interface SearchChunk {
  chunkId: string;
  documentId: string;
  documentName: string;
  content: string;
  chunkIndex: number;
  score: number;
  metadata: Record<string, unknown>;
}

@Injectable()
export class ElasticsearchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new LoggerService(ElasticsearchService.name);
  private client: Client;
  private readonly indexName: string;

  constructor(private readonly configService: ConfigService) {
    this.indexName = this.configService.get<string>('ELASTICSEARCH_CHUNK_INDEX', 'document_chunks_v2');
    this.client = new Client({ node: this.configService.get<string>('ELASTICSEARCH_URL', 'http://localhost:9200') });
  }

  async onModuleInit(): Promise<void> {
    const exists = await this.client.indices.exists({ index: this.indexName });
    if (!exists) {
      await this.client.indices.create({
        index: this.indexName,
        mappings: {
          properties: {
            chunkId: { type: 'keyword' },
            documentId: { type: 'keyword' },
            documentName: { type: 'text' },
            content: { type: 'text' },
            chunkIndex: { type: 'integer' },
            status: { type: 'keyword' },
            pageNumber: { type: 'integer' },
            sheetName: { type: 'keyword' },
            slideNumber: { type: 'integer' },
          },
        },
      });
    }
    this.logger.info(`Elasticsearch分块索引初始化完成 - 索引: ${this.indexName}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.close();
    this.logger.info('Elasticsearch客户端已关闭');
  }

  @LogServiceCall()
  async indexChunks(chunks: SearchChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    const operations = chunks.flatMap((chunk) => [
      { index: { _index: this.indexName, _id: chunk.chunkId } },
      { ...chunk.metadata, ...chunk, status: 'processed', metadata: undefined, score: undefined },
    ]);
    const response = await this.client.bulk({ refresh: true, operations });
    if (response.errors) throw new Error('Elasticsearch分块批量索引失败');
  }

  @LogServiceCall()
  async search(query: string, topK = 30, documentIds?: string[]): Promise<SearchChunk[]> {
    const filters: Array<Record<string, unknown>> = [{ term: { status: 'processed' } }];
    if (documentIds?.length) filters.push({ terms: { documentId: documentIds } });
    const response = await this.client.search<Record<string, unknown>>({
      index: this.indexName,
      size: topK,
      query: {
        bool: {
          must: [{ multi_match: { query, fields: ['content^3', 'documentName', 'headingPath'] } }],
          filter: filters,
        },
      },
    });
    return response.hits.hits.map((hit) => {
      const source = hit._source ?? {};
      const { content, chunkId, documentId, documentName, chunkIndex, ...metadata } = source;
      return {
        chunkId: typeof chunkId === 'string' ? chunkId : String(hit._id ?? ''),
        documentId: typeof documentId === 'string' ? documentId : '',
        documentName: typeof documentName === 'string' ? documentName : '',
        content: typeof content === 'string' ? content : '',
        chunkIndex: Number(chunkIndex ?? 0),
        score: hit._score ?? 0,
        metadata,
      };
    });
  }

  @LogServiceCall()
  async deleteByDocumentId(documentId: string): Promise<void> {
    await this.client.deleteByQuery({
      index: this.indexName,
      refresh: true,
      query: { term: { documentId } },
    });
  }

  @LogServiceCall()
  async deleteByChunkId(chunkId: string): Promise<void> {
    await this.client.delete({ index: this.indexName, id: chunkId, refresh: true }, { ignore: [404] });
  }

  @LogServiceCall()
  async countByDocumentId(documentId: string): Promise<number> {
    const result = await this.client.count({ index: this.indexName, query: { term: { documentId } } });
    return result.count;
  }
}
