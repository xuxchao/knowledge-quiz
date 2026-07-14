import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Driver, Session, auth } from 'neo4j-driver';
import neo4j from 'neo4j-driver';
import { LoggerService, LogServiceCall } from '../../common/logger';

type Neo4jPrimitive = string | number | boolean;
type Neo4jPropertyValue = Neo4jPrimitive | Neo4jPrimitive[];

@Injectable()
export class Neo4jService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new LoggerService(Neo4jService.name);
  private driver: Driver;
  private readonly indexName: string;
  private readonly embeddingDimensions: number;
  private activeIndexName: string;

  constructor(private configService: ConfigService) {
    this.indexName = this.configService.get<string>('NEO4J_VECTOR_INDEX', 'document_embeddings_v2');
    this.activeIndexName = this.indexName;
    this.embeddingDimensions = Number(this.configService.get<string>('EMBEDDING_DIMENSIONS', '1536'));
    if (!/^[A-Za-z0-9_]+$/.test(this.indexName)) throw new Error('NEO4J_VECTOR_INDEX格式无效');
  }

  async onModuleInit() {
    const uri = this.configService.get<string>('NEO4J_URI', 'bolt://localhost:7687');
    const username = this.configService.get<string>('NEO4J_USER', 'neo4j');
    const password = this.configService.get<string>('NEO4J_PASSWORD', 'password');

    this.driver = neo4j.driver(uri, auth.basic(username, password));
    await this.driver.verifyConnectivity();
    await this.createVectorIndex();
    this.logger.info('Neo4j服务初始化完成');
  }

  async onModuleDestroy() {
    await this.driver.close();
    this.logger.info('Neo4j连接已关闭');
  }

  getDriver(): Driver {
    return this.driver;
  }

  @LogServiceCall()
  async createVectorIndex(): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run(`
        CREATE VECTOR INDEX ${this.indexName} IF NOT EXISTS
        FOR (c:DocumentChunk)
        ON c.embedding
        OPTIONS { indexConfig: {
          \`vector.dimensions\`: ${this.embeddingDimensions},
          \`vector.similarity_function\`: 'cosine'
        }}
      `);
      this.activeIndexName = await this.waitForVectorIndex(session);
      if (this.activeIndexName !== this.indexName) {
        this.logger.warn(
          `配置的Neo4j向量索引不存在，复用同架构索引 - 配置索引: ${this.indexName}，实际索引: ${this.activeIndexName}`,
        );
      }
    } finally {
      await session.close();
    }
  }

  @LogServiceCall()
  async addDocuments(
    documents: { content: string; metadata: Record<string, unknown> }[],
    embeddings: number[][],
  ): Promise<void> {
    const session = this.driver.session();
    try {
      const rows = documents.map((document, index) => ({
        properties: this.buildDocumentChunkProperties(document, embeddings[index]),
      }));
      await session.run(
        `
        UNWIND $rows AS row
        MERGE (c:DocumentChunk { chunkId: row.properties.chunkId })
        SET c = row.properties
        `,
        { rows },
      );
    } finally {
      await session.close();
    }
  }

  @LogServiceCall()
  async addDocumentsBatch(
    documents: { content: string; metadata: Record<string, unknown> }[],
    embeddings: number[][],
    batchSize: number = 50,
  ): Promise<void> {
    for (let i = 0; i < documents.length; i += batchSize) {
      const batchDocs = documents.slice(i, Math.min(i + batchSize, documents.length));
      const batchEmbs = embeddings.slice(i, Math.min(i + batchSize, embeddings.length));
      await this.addDocuments(batchDocs, batchEmbs);
    }
  }

  @LogServiceCall()
  async search(
    queryEmbedding: number[],
    topK: number = 5,
    documentIds?: string[],
  ): Promise<{ content: string; metadata: Record<string, unknown>; score: number }[]> {
    const session = this.driver.session();
    try {
      try {
        return await this.queryVectorIndex(session, queryEmbedding, topK, documentIds);
      } catch (error: unknown) {
        if (!this.isMissingVectorIndexError(error)) {
          throw error;
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        const stackTrace = error instanceof Error ? error.stack : undefined;
        this.logger.error(
          `Neo4j向量索引缺失，正在自动重建 - 索引: ${this.activeIndexName}，错误: ${errorMessage}`,
          stackTrace,
        );
        await this.createVectorIndex();
        return await this.queryVectorIndex(session, queryEmbedding, topK, documentIds);
      }
    } finally {
      await session.close();
    }
  }

  private async queryVectorIndex(
    session: Session,
    queryEmbedding: number[],
    topK: number,
    documentIds?: string[],
  ): Promise<{ content: string; metadata: Record<string, unknown>; score: number }[]> {
    const result = await session.run(
      `
        CALL db.index.vector.queryNodes($indexName, $topK, $queryEmbedding)
        YIELD node, score
        WHERE size($documentIds) = 0 OR node.documentId IN $documentIds
        RETURN node.content AS content, properties(node) AS properties, score
        ORDER BY score DESC
      `,
      {
        topK,
        queryEmbedding,
        indexName: this.activeIndexName,
        documentIds: documentIds ?? [],
      },
    );

    return result.records.map((record) => ({
      content: record.get('content') as string,
      metadata: this.extractMetadata(record.get('properties') as Record<string, unknown>),
      score: record.get('score') as number,
    }));
  }

  private isMissingVectorIndexError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('There is no such vector schema index');
  }

  private async waitForVectorIndex(session: Session): Promise<string> {
    const timeoutMs = 30000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const result = await session.run(
        `
        SHOW VECTOR INDEXES
        YIELD name, labelsOrTypes, properties, state, failureMessage
        WHERE labelsOrTypes = $labelsOrTypes AND properties = $properties
        RETURN name, state, failureMessage
        `,
        {
          labelsOrTypes: ['DocumentChunk'],
          properties: ['embedding'],
        },
      );
      const configuredIndex = result.records.find((record) => record.get('name') === this.indexName);
      const index = configuredIndex ?? result.records[0];
      const name = index?.get('name') as string | undefined;
      const state = index?.get('state') as string | undefined;
      const failureMessage = index?.get('failureMessage') as string | undefined;

      if (name && state === 'ONLINE') {
        return name;
      }
      if (state === 'FAILED') {
        throw new Error(`Neo4j向量索引创建失败: ${failureMessage || name || this.indexName}`);
      }

      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }

    throw new Error(`等待Neo4j向量索引就绪超时: ${this.indexName}`);
  }

  @LogServiceCall()
  async countByDocumentId(documentId: string): Promise<number> {
    const session = this.driver.session();
    try {
      const result = await session.run('MATCH (c:DocumentChunk {documentId: $documentId}) RETURN count(c) AS count', {
        documentId,
      });
      const raw = result.records[0]?.get('count') as { toNumber?: () => number } | undefined;
      return raw?.toNumber?.() ?? Number(raw ?? 0);
    } finally {
      await session.close();
    }
  }

  @LogServiceCall()
  async deleteByDocumentId(documentId: string): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run(
        `
        MATCH (c:DocumentChunk)
        WHERE c.documentId = $documentId
        DELETE c
      `,
        { documentId },
      );
    } finally {
      await session.close();
    }
  }

  @LogServiceCall()
  async deleteByChunkId(chunkId: string): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run('MATCH (c:DocumentChunk { chunkId: $chunkId }) DELETE c', { chunkId });
    } finally {
      await session.close();
    }
  }

  private buildDocumentChunkProperties(
    document: { content: string; metadata: Record<string, unknown> },
    embedding: number[],
  ): Record<string, Neo4jPropertyValue> {
    return {
      content: document.content,
      embedding,
      ...this.toNeo4jProperties(document.metadata),
    };
  }

  private toNeo4jProperties(metadata: Record<string, unknown>): Record<string, Neo4jPropertyValue> {
    return Object.entries(metadata).reduce<Record<string, Neo4jPropertyValue>>((properties, [key, value]) => {
      const propertyValue = this.toNeo4jPropertyValue(value);

      if (propertyValue !== undefined) {
        properties[key] = propertyValue;
      }

      return properties;
    }, {});
  }

  private toNeo4jPropertyValue(value: unknown): Neo4jPropertyValue | undefined {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    if (Array.isArray(value)) {
      const primitiveValues = value.filter((item): item is Neo4jPrimitive => this.isNeo4jPrimitive(item));
      const firstType = primitiveValues.length > 0 ? typeof primitiveValues[0] : undefined;
      const isSupportedArray =
        primitiveValues.length === value.length && primitiveValues.every((item) => typeof item === firstType);

      return isSupportedArray ? primitiveValues : JSON.stringify(value);
    }

    if (value === null || value === undefined) {
      return undefined;
    }

    return JSON.stringify(value);
  }

  private isNeo4jPrimitive(value: unknown): value is Neo4jPrimitive {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
  }

  private extractMetadata(properties: Record<string, unknown>): Record<string, unknown> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { content, embedding, ...metadata } = properties;
    return metadata;
  }
}
