import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Driver, auth } from 'neo4j-driver';
import neo4j from 'neo4j-driver';
import { LoggerService, LogServiceCall } from '../../common/logger';

type Neo4jPrimitive = string | number | boolean;
type Neo4jPropertyValue = Neo4jPrimitive | Neo4jPrimitive[];

@Injectable()
export class Neo4jService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new LoggerService(Neo4jService.name);
  private driver: Driver;

  constructor(private configService: ConfigService) {}

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
        CREATE VECTOR INDEX document_embeddings IF NOT EXISTS
        FOR (c:DocumentChunk)
        ON c.embedding
        OPTIONS { indexConfig: {
          \`vector.dimensions\`: 1536,
          \`vector.similarity_function\`: 'cosine'
        }}
      `);
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
  ): Promise<{ content: string; metadata: Record<string, unknown>; score: number }[]> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `
        CALL db.index.vector.queryNodes('document_embeddings', $topK, $queryEmbedding)
        YIELD node, score
        RETURN node.content AS content, properties(node) AS properties, score
        ORDER BY score DESC
      `,
        {
          topK,
          queryEmbedding,
        },
      );

      return result.records.map((record) => ({
        content: record.get('content') as string,
        metadata: this.extractMetadata(record.get('properties') as Record<string, unknown>),
        score: record.get('score') as number,
      }));
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
