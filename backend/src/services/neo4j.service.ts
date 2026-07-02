import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Neo4jVectorStore } from '@langchain/community/vectorstores/neo4j_vector';
import { Neo4jGraph } from '@langchain/community/graphs/neo4j_graph';
import { Driver, GraphDatabase } from 'neo4j-driver';
import { Embeddings } from '@langchain/core/embeddings';

@Injectable()
export class Neo4jService implements OnModuleInit, OnModuleDestroy {
  private driver: Driver;
  private graph: Neo4jGraph;
  private vectorStore: Neo4jVectorStore | null = null;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const uri = this.configService.get<string>('NEO4J_URI', 'bolt://localhost:7687');
    const username = this.configService.get<string>('NEO4J_USER', 'neo4j');
    const password = this.configService.get<string>('NEO4J_PASSWORD', 'password');

    this.driver = GraphDatabase.driver(uri, { auth: { username, password } });
    await this.driver.verifyConnectivity();

    this.graph = new Neo4jGraph({
      url: uri,
      username,
      password,
    });
  }

  async onModuleDestroy() {
    await this.driver.close();
  }

  getDriver(): Driver {
    return this.driver;
  }

  getGraph(): Neo4jGraph {
    return this.graph;
  }

  async getVectorStore(embeddings: Embeddings): Promise<Neo4jVectorStore> {
    if (!this.vectorStore) {
      const username = this.configService.get<string>('NEO4J_USER', 'neo4j');
      const password = this.configService.get<string>('NEO4J_PASSWORD', 'password');
      const uri = this.configService.get<string>('NEO4J_URI', 'bolt://localhost:7687');

      this.vectorStore = await Neo4jVectorStore.fromExistingIndex(embeddings, {
        url: uri,
        username,
        password,
        indexName: 'document_embeddings',
        nodeLabel: 'DocumentChunk',
        textProperty: 'content',
        embeddingProperty: 'embedding',
      });
    }
    return this.vectorStore;
  }

  async createVectorIndex(): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run(`
        CREATE VECTOR INDEX document_embeddings IF NOT EXISTS
        FOR (c:DocumentChunk)
        ON c.embedding
        OPTIONS { indexConfig: {
          vector.dimensions: 1536,
          vector.similarity_function: 'cosine'
        }}
      `);
    } finally {
      await session.close();
    }
  }

  async addDocuments(documents: { content: string; metadata: Record<string, unknown> }[], embeddings: number[][]): Promise<void> {
    const session = this.driver.session();
    try {
      for (let i = 0; i < documents.length; i++) {
        await session.run(`
          CREATE (c:DocumentChunk {
            content: $content,
            metadata: $metadata,
            embedding: $embedding
          })
        `, {
          content: documents[i].content,
          metadata: documents[i].metadata,
          embedding: embeddings[i],
        });
      }
    } finally {
      await session.close();
    }
  }

  async search(queryEmbedding: number[], topK: number = 5): Promise<{ content: string; metadata: Record<string, unknown>; score: number }[]> {
    const session = this.driver.session();
    try {
      const result = await session.run(`
        CALL db.index.vector.queryNodes('document_embeddings', $topK, $queryEmbedding)
        YIELD node, score
        RETURN node.content AS content, node.metadata AS metadata, score
        ORDER BY score DESC
      `, {
        topK,
        queryEmbedding,
      });

      return result.records.map(record => ({
        content: record.get('content'),
        metadata: record.get('metadata'),
        score: record.get('score'),
      }));
    } finally {
      await session.close();
    }
  }

  async deleteByDocumentId(documentId: string): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run(`
        MATCH (c:DocumentChunk)
        WHERE c.metadata.documentId = $documentId
        DELETE c
      `, { documentId });
    } finally {
      await session.close();
    }
  }
}
