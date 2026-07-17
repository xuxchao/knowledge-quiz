import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import neo4j, { auth, Driver } from 'neo4j-driver';
import { LoggerService, LogServiceCall } from '../../common/logger';
import type {
  GraphEvidence,
  NovelGraphEntity,
  NovelGraphPayload,
  NovelGraphRelation,
  NovelQueryPlan,
} from './novel-graph.types';

@Injectable()
export class Neo4jService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new LoggerService(Neo4jService.name);
  private driver: Driver;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const uri = this.configService.get<string>('NEO4J_URI', 'bolt://localhost:7687');
    const username = this.configService.get<string>('NEO4J_USER', 'neo4j');
    const password = this.configService.get<string>('NEO4J_PASSWORD', 'password');
    this.driver = neo4j.driver(uri, auth.basic(username, password));
    await this.driver.verifyConnectivity();
    await this.ensureSchema();
    this.logger.info('Neo4j小说图谱服务初始化完成');
  }

  async onModuleDestroy(): Promise<void> {
    await this.driver?.close();
  }

  getDriver(): Driver {
    return this.driver;
  }

  @LogServiceCall()
  async ensureSchema(): Promise<void> {
    const session = this.driver.session();
    try {
      for (const label of ['Novel', 'Chapter', 'Character', 'Location', 'Organization', 'Event']) {
        await session.run(
          `CREATE CONSTRAINT ${label.toLowerCase()}_id IF NOT EXISTS FOR (n:${label}) REQUIRE n.id IS UNIQUE`,
        );
      }
      for (const label of ['Character', 'Location', 'Organization', 'Event']) {
        await session.run(
          `CREATE INDEX ${label.toLowerCase()}_document_name IF NOT EXISTS FOR (n:${label}) ON (n.documentId, n.normalizedName)`,
        );
      }
      await session.run(
        'CREATE INDEX chapter_document_ordinal IF NOT EXISTS FOR (n:Chapter) ON (n.documentId, n.ordinal)',
      );
    } finally {
      await session.close();
    }
  }

  @LogServiceCall()
  async replaceNovelGraph(payload: NovelGraphPayload): Promise<void> {
    const session = this.driver.session();
    try {
      await session.executeWrite(async (transaction) => {
        await transaction.run('MATCH (n {documentId: $documentId}) DETACH DELETE n', {
          documentId: payload.novel.documentId,
        });
        await transaction.run('CREATE (n:Novel) SET n = $properties', { properties: payload.novel });
        await transaction.run('UNWIND $rows AS row CREATE (n:Chapter) SET n = row', { rows: payload.chapters });
        for (const label of ['Character', 'Location', 'Organization', 'Event'] as const) {
          const rows = payload.entities
            .filter((entity) => entity.type === label)
            .map((entity) => this.entityProperties(entity));
          if (rows.length) await transaction.run(`UNWIND $rows AS row CREATE (n:${label}) SET n = row`, { rows });
        }
        for (const type of this.relationTypes()) {
          const rows = payload.relations
            .filter((relation) => relation.type === type)
            .map((relation) => ({
              ...this.relationProperties(relation),
              sourceId: relation.sourceId,
              targetId: relation.targetId,
            }));
          if (!rows.length) continue;
          await transaction.run(
            `
              UNWIND $rows AS row
              MATCH (source {id: row.sourceId}), (target {id: row.targetId})
              CREATE (source)-[r:${type}]->(target)
              SET r = row
              REMOVE r.sourceId, r.targetId
            `,
            { rows },
          );
        }
        const relationshipResult = await transaction.run(
          `
            MATCH (source {documentId: $documentId})-[relation]->(target {documentId: $documentId})
            RETURN count(relation) AS count
          `,
          { documentId: payload.novel.documentId },
        );
        const relationshipCount = this.neo4jNumber(relationshipResult.records[0]?.get('count'), 0);
        if (relationshipCount === 0) throw new Error('Neo4j图谱写入失败：文档图谱没有任何关联关系');
        const isolatedNodeResult = await transaction.run(
          `
            MATCH (node {documentId: $documentId})
            WHERE NOT (node)--()
            RETURN count(node) AS count
          `,
          { documentId: payload.novel.documentId },
        );
        const isolatedNodeCount = this.neo4jNumber(isolatedNodeResult.records[0]?.get('count'), 0);
        if (isolatedNodeCount > 0) {
          throw new Error(`Neo4j图谱写入失败：文档图谱存在${isolatedNodeCount}个孤立节点`);
        }
      });
    } finally {
      await session.close();
    }
  }

  @LogServiceCall()
  async searchGraph(plan: NovelQueryPlan, documentIds?: string[], topK = 20): Promise<GraphEvidence[]> {
    const session = this.driver.session();
    try {
      const entities = plan.entities.map((value) => this.normalizeName(value)).filter(Boolean);
      const result = await session.run(
        `
          MATCH (source)-[relation]->(target)
          MATCH (novel:Novel {documentId: source.documentId})
          WHERE source.documentId = target.documentId
            AND (size($documentIds) = 0 OR source.documentId IN $documentIds)
            AND (
              size($entities) = 0 OR any(entity IN $entities WHERE
                coalesce(source.normalizedName, '') CONTAINS entity OR
                coalesce(target.normalizedName, '') CONTAINS entity OR
                any(alias IN coalesce(source.aliases, []) WHERE toLower(alias) CONTAINS entity) OR
                any(alias IN coalesce(target.aliases, []) WHERE toLower(alias) CONTAINS entity)
              )
            )
            AND (size($relationshipKinds) = 0 OR type(relation) IN $relationshipKinds OR relation.kind IN $relationshipKinds)
            AND ($chapterOrdinal IS NULL OR relation.chapterOrdinal = $chapterOrdinal OR source.ordinal = $chapterOrdinal OR target.ordinal = $chapterOrdinal)
            AND ($novelTitle = '' OR toLower(novel.title) CONTAINS toLower($novelTitle))
          RETURN properties(source) AS source, type(relation) AS relationType,
                 properties(relation) AS relation, properties(target) AS target,
                 novel.title AS documentName
          ORDER BY coalesce(relation.confidence, 1.0) DESC
          LIMIT $topK
        `,
        {
          documentIds: documentIds ?? [],
          entities,
          relationshipKinds: plan.relationshipKinds,
          chapterOrdinal: plan.chapterOrdinal ?? null,
          novelTitle: plan.novelTitle ?? '',
          topK: neo4j.int(Math.max(1, Math.min(topK, 100))),
        },
      );

      return result.records.map((record) => {
        const source = record.get('source') as Record<string, unknown>;
        const target = record.get('target') as Record<string, unknown>;
        const relation = record.get('relation') as Record<string, unknown>;
        const relationType = String(record.get('relationType'));
        const relationName = typeof relation.kind === 'string' ? relation.kind : relationType;
        const description = typeof relation.description === 'string' ? `：${relation.description}` : '';
        return {
          documentId: String(source.documentId),
          documentName: String(record.get('documentName')),
          statement: `${this.displayName(source)} -[${relationName}]-> ${this.displayName(target)}${description}`,
          evidenceChunkIds: this.stringArray(relation.evidenceChunkIds),
          confidence: this.neo4jNumber(relation.confidence, 1),
        };
      });
    } finally {
      await session.close();
    }
  }

  @LogServiceCall()
  async countGraphNodesByDocumentId(documentId: string): Promise<number> {
    const session = this.driver.session();
    try {
      const result = await session.run('MATCH (n {documentId: $documentId}) RETURN count(n) AS count', { documentId });
      return this.neo4jNumber(result.records[0]?.get('count'), 0);
    } finally {
      await session.close();
    }
  }

  @LogServiceCall()
  async deleteByDocumentId(documentId: string): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run('MATCH (n {documentId: $documentId}) DETACH DELETE n', { documentId });
    } finally {
      await session.close();
    }
  }

  @LogServiceCall()
  async deleteLegacyVectorData(): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run('MATCH (c:DocumentChunk) DETACH DELETE c');
      const indexes = await session.run(
        "SHOW VECTOR INDEXES YIELD name, labelsOrTypes WHERE 'DocumentChunk' IN labelsOrTypes RETURN name",
      );
      for (const record of indexes.records) {
        const name = String(record.get('name'));
        if (/^[A-Za-z0-9_]+$/.test(name)) await session.run(`DROP INDEX ${name} IF EXISTS`);
      }
    } finally {
      await session.close();
    }
  }

  private relationTypes(): NovelGraphRelation['type'][] {
    return [
      'HAS_CHAPTER',
      'NEXT_CHAPTER',
      'APPEARS_IN',
      'OCCURS_IN',
      'MENTIONED_IN',
      'PARTICIPATES_IN',
      'LOCATED_AT',
      'MEMBER_OF',
      'CAUSES',
      'RELATED_TO',
    ];
  }

  private entityProperties(entity: NovelGraphEntity): Record<string, unknown> {
    const { type: _type, ...properties } = entity;
    return properties;
  }

  private relationProperties(relation: NovelGraphRelation): Record<string, unknown> {
    return Object.fromEntries(Object.entries(relation).filter(([, value]) => value !== undefined));
  }

  private normalizeName(value: string): string {
    return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  }

  private displayName(properties: Record<string, unknown>): string {
    return String(properties.name ?? properties.title ?? `第${this.neo4jNumber(properties.ordinal, 0)}章`);
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }

  private neo4jNumber(value: unknown, fallback: number): number {
    if (typeof value === 'number') return value;
    if (value && typeof value === 'object' && 'toNumber' in value) {
      return (value as { toNumber(): number }).toNumber();
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
}
