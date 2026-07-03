import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Driver, auth } from 'neo4j-driver';
import neo4j from 'neo4j-driver';

@Injectable()
export class Neo4jService implements OnModuleInit, OnModuleDestroy {
  private driver: Driver;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const uri = this.configService.get<string>(
      'NEO4J_URI',
      'bolt://localhost:7687',
    );
    const username = this.configService.get<string>('NEO4J_USER', 'neo4j');
    const password = this.configService.get<string>(
      'NEO4J_PASSWORD',
      'password',
    );

    this.driver = neo4j.driver(uri, auth.basic(username, password));
    await this.driver.verifyConnectivity();
    await this.createVectorIndex();
  }

  async onModuleDestroy() {
    await this.driver.close();
  }

  getDriver(): Driver {
    return this.driver;
  }

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

  async addDocuments(
    documents: { content: string; metadata: Record<string, unknown> }[],
    embeddings: number[][],
  ): Promise<void> {
    const session = this.driver.session();
    try {
      for (let i = 0; i < documents.length; i++) {
        await session.run(
          `
          CREATE (c:DocumentChunk {
            content: $content,
            metadata: $metadata,
            embedding: $embedding
          })
        `,
          {
            content: documents[i].content,
            metadata: documents[i].metadata,
            embedding: embeddings[i],
          },
        );
      }
    } finally {
      await session.close();
    }
  }

  async search(
    queryEmbedding: number[],
    topK: number = 5,
  ): Promise<
    { content: string; metadata: Record<string, unknown>; score: number }[]
  > {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `
        CALL db.index.vector.queryNodes('document_embeddings', $topK, $queryEmbedding)
        YIELD node, score
        RETURN node.content AS content, node.metadata AS metadata, score
        ORDER BY score DESC
      `,
        {
          topK,
          queryEmbedding,
        },
      );

      return result.records.map((record) => ({
        content: record.get('content') as string,
        metadata: record.get('metadata') as Record<string, unknown>,
        score: record.get('score') as number,
      }));
    } finally {
      await session.close();
    }
  }

  async deleteByDocumentId(documentId: string): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run(
        `
        MATCH (c:DocumentChunk)
        WHERE c.metadata.documentId = $documentId
        DELETE c
      `,
        { documentId },
      );
    } finally {
      await session.close();
    }
  }
}
