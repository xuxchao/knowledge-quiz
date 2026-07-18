import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiService } from '../ai/ai.service';
import { LoggerService, LogServiceCall } from '../common/logger';
import { Chunk } from '../entities/chunk.entity';
import { Document, NovelGraphStatus } from '../entities/document.entity';
import { Neo4jService } from '../infrastructure/neo4j/neo4j.service';
import {
  CharacterRelationKind,
  NovelEntityType,
  NovelGraphEntity,
  NovelGraphPayload,
  NovelGraphRelation,
} from '../infrastructure/neo4j/novel-graph.types';

interface RawEntity {
  type?: string;
  name?: string;
  aliases?: unknown;
  description?: string;
  evidenceChunkIds?: unknown;
}

interface RawRelation {
  source?: string;
  target?: string;
  type?: string;
  kind?: string;
  description?: string;
  confidence?: number;
  evidenceChunkIds?: unknown;
}

interface RawExtraction {
  entities?: RawEntity[];
  relations?: RawRelation[];
}

interface ExtractedWindow {
  chapterOrdinal: number;
  entities: RawEntity[];
  relations: RawRelation[];
}

@Injectable()
export class NovelGraphExtractionService {
  private readonly logger = new LoggerService(NovelGraphExtractionService.name);
  private readonly graphVersion: string;
  private readonly minConfidence: number;
  private readonly windowTokens: number;
  private readonly stageTimeoutMs: number;

  constructor(
    @InjectRepository(Document) private readonly documentRepository: Repository<Document>,
    @InjectRepository(Chunk) private readonly chunkRepository: Repository<Chunk>,
    private readonly aiService: AiService,
    private readonly neo4jService: Neo4jService,
    configService: ConfigService,
  ) {
    this.graphVersion = configService.get<string>('NOVEL_GRAPH_VERSION', '1');
    this.minConfidence = Number(configService.get<string>('NOVEL_GRAPH_MIN_CONFIDENCE', '0.7'));
    this.windowTokens = Number(configService.get<string>('NOVEL_GRAPH_WINDOW_TOKENS', '6000'));
    this.stageTimeoutMs = Number(configService.get<string>('NOVEL_GRAPH_STAGE_TIMEOUT_MS', '180000'));
  }

  @LogServiceCall()
  async extractAndStore(documentId: string): Promise<NovelGraphPayload> {
    const document = await this.documentRepository.findOne({ where: { id: documentId } });
    if (!document) throw new Error('文档不存在');
    const chunks = await this.chunkRepository.find({ where: { documentId }, order: { chunkIndex: 'ASC' } });
    if (!chunks.length) throw new Error('文档没有可用于图谱抽取的切片');
    await this.documentRepository.update(documentId, {
      graphStatus: NovelGraphStatus.PROCESSING,
      graphError: null,
    });

    const abortController = new AbortController();
    const timeout = setTimeout(
      () => abortController.abort(new Error(`小说图谱抽取超过${this.stageTimeoutMs}毫秒`)),
      this.stageTimeoutMs,
    );
    timeout.unref();
    try {
      const windows = this.buildWindows(chunks);
      const extracted: ExtractedWindow[] = [];
      for (const window of windows) {
        const raw = await this.aiService.generateStructuredJson<RawExtraction>(
          this.extractionPrompt(),
          `小说：${document.name}\n章节：${window.title}\n\n${window.chunks
            .map((chunk) => `[${chunk.id}] ${chunk.content}`)
            .join('\n\n')}`,
          'novel-graph.extract-window',
          abortController.signal,
        );
        extracted.push({
          chapterOrdinal: window.ordinal,
          entities: Array.isArray(raw.entities) ? raw.entities.slice(0, 12) : [],
          relations: Array.isArray(raw.relations) ? raw.relations.slice(0, 12) : [],
        });
      }

      const payload = await this.buildPayload(document, chunks, extracted, abortController.signal);
      await this.neo4jService.replaceNovelGraph(payload);
      await this.documentRepository.update(documentId, {
        graphStatus: NovelGraphStatus.READY,
        graphVersion: this.graphVersion,
        graphError: null,
        graphUpdatedAt: new Date(),
      });
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  @LogServiceCall()
  async markFailed(documentId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.documentRepository.update(documentId, {
      graphStatus: NovelGraphStatus.FAILED,
      graphVersion: this.graphVersion,
      graphError: message,
      graphUpdatedAt: new Date(),
    });
  }

  private buildWindows(chunks: Chunk[]): Array<{ ordinal: number; title: string; chunks: Chunk[] }> {
    const windows: Array<{ ordinal: number; title: string; chunks: Chunk[] }> = [];
    let current: Chunk[] = [];
    let currentTokens = 0;
    let currentOrdinal = 1;
    let currentTitle = '正文';
    const flush = () => {
      if (current.length) windows.push({ ordinal: currentOrdinal, title: currentTitle, chunks: current });
      current = [];
      currentTokens = 0;
    };
    for (const chunk of chunks) {
      const ordinal = Number(chunk.metadata?.chapterOrdinal ?? 1);
      const title = typeof chunk.metadata?.chapterTitle === 'string' ? chunk.metadata.chapterTitle : `第${ordinal}章`;
      if (current.length && (ordinal !== currentOrdinal || currentTokens + chunk.tokenCount > this.windowTokens))
        flush();
      currentOrdinal = ordinal;
      currentTitle = title;
      current.push(chunk);
      currentTokens += chunk.tokenCount;
    }
    flush();
    return windows;
  }

  private async buildPayload(
    document: Document,
    chunks: Chunk[],
    extracted: ExtractedWindow[],
    signal?: AbortSignal,
  ): Promise<NovelGraphPayload> {
    const validChunkIds = new Set(chunks.map((chunk) => chunk.id));
    const chapterMap = new Map<number, { id: string; title: string; evidenceChunkIds: string[] }>();
    for (const chunk of chunks) {
      const ordinal = Number(chunk.metadata?.chapterOrdinal ?? 1);
      const id = `${document.id}:chapter:${ordinal}`;
      const title = typeof chunk.metadata?.chapterTitle === 'string' ? chunk.metadata.chapterTitle : `第${ordinal}章`;
      const chapter = chapterMap.get(ordinal) ?? { id, title, evidenceChunkIds: [] };
      chapter.evidenceChunkIds.push(chunk.id);
      chapterMap.set(ordinal, chapter);
    }
    const chapters = [...chapterMap.entries()]
      .sort(([left], [right]) => left - right)
      .map(([ordinal, chapter]) => ({
        ...chapter,
        documentId: document.id,
        ordinal,
      }));

    const aliasMap = await this.buildAliasMap(
      extracted.flatMap((window) => window.entities),
      signal,
    );
    const entities = new Map<string, NovelGraphEntity>();
    const mentions: Array<{ entityId: string; chapterOrdinal: number; evidenceChunkIds: string[] }> = [];
    for (const window of extracted) {
      for (const raw of window.entities) {
        if (!this.isEntityType(raw.type) || !raw.name?.trim()) continue;
        const normalizedInput = this.normalizeName(raw.name);
        const canonicalName = aliasMap.get(normalizedInput) ?? raw.name.trim();
        const normalizedName = this.normalizeName(canonicalName);
        const key = raw.type === '事件' ? `${normalizedName}:${window.chapterOrdinal}` : normalizedName;
        const id = this.stableId(document.id, raw.type, key);
        const evidenceChunkIds = this.validEvidence(raw.evidenceChunkIds, validChunkIds);
        if (!evidenceChunkIds.length) continue;
        const existing = entities.get(id);
        const aliases = this.stringArray(raw.aliases).filter((alias) => this.normalizeName(alias) !== normalizedName);
        entities.set(id, {
          id,
          documentId: document.id,
          type: raw.type,
          name: canonicalName,
          normalizedName,
          aliases: [...new Set([...(existing?.aliases ?? []), raw.name.trim(), ...aliases])].filter(
            (alias) => this.normalizeName(alias) !== normalizedName,
          ),
          description: existing?.description ?? raw.description,
          evidenceChunkIds: [...new Set([...(existing?.evidenceChunkIds ?? []), ...evidenceChunkIds])],
        });
        mentions.push({ entityId: id, chapterOrdinal: window.chapterOrdinal, evidenceChunkIds });
      }
    }

    const relations: NovelGraphRelation[] = [];
    const novelId = `${document.id}:novel`;
    chapters.forEach((chapter, index) => {
      relations.push(
        this.structuralRelation(
          document.id,
          novelId,
          chapter.id,
          '包含章节',
          chapter.ordinal,
          chapter.evidenceChunkIds,
        ),
      );
      if (index > 0) {
        relations.push(
          this.structuralRelation(
            document.id,
            chapters[index - 1].id,
            chapter.id,
            '下一章',
            chapter.ordinal,
            chapter.evidenceChunkIds,
          ),
        );
      }
    });
    for (const mention of mentions) {
      const entity = entities.get(mention.entityId);
      const chapter = chapterMap.get(mention.chapterOrdinal);
      if (!entity || !chapter) continue;
      const type = entity.type === '事件' ? '发生于' : entity.type === '角色' ? '出现于' : '提及于';
      relations.push(
        this.structuralRelation(
          document.id,
          entity.id,
          chapter.id,
          type,
          mention.chapterOrdinal,
          mention.evidenceChunkIds,
        ),
      );
    }

    for (const window of extracted) {
      for (const raw of window.relations) {
        if (!this.isRelationType(raw.type)) continue;
        const confidence = Number(raw.confidence ?? 0);
        const evidenceChunkIds = this.validEvidence(raw.evidenceChunkIds, validChunkIds);
        if (confidence < this.minConfidence || !evidenceChunkIds.length || !raw.source || !raw.target) continue;
        const source = this.resolveEntity(entities, aliasMap, raw.source, window.chapterOrdinal);
        const target = this.resolveEntity(entities, aliasMap, raw.target, window.chapterOrdinal);
        if (
          !source ||
          !target ||
          source.documentId !== target.documentId ||
          !this.isValidEndpointPair(raw.type, source.type, target.type)
        )
          continue;
        const kind = raw.type === '相关' && this.isRelationKind(raw.kind) ? raw.kind : undefined;
        relations.push({
          id: this.stableId(
            document.id,
            raw.type,
            `${source.id}|${target.id}|${window.chapterOrdinal}|${kind ?? ''}|${raw.description ?? ''}`,
          ),
          documentId: document.id,
          sourceId: source.id,
          targetId: target.id,
          type: raw.type,
          kind,
          description: raw.description,
          chapterOrdinal: window.chapterOrdinal,
          confidence,
          evidenceChunkIds,
        });
      }
    }

    return {
      novel: { id: novelId, documentId: document.id, title: document.name },
      chapters,
      entities: [...entities.values()],
      relations: [...new Map(relations.map((relation) => [relation.id, relation])).values()],
      version: this.graphVersion,
    };
  }

  private async buildAliasMap(entities: RawEntity[], signal?: AbortSignal): Promise<Map<string, string>> {
    const names = [
      ...new Set(
        entities
          .flatMap((entity) => [entity.name, ...this.stringArray(entity.aliases)])
          .filter((name): name is string => Boolean(name?.trim())),
      ),
    ];
    const aliases = new Map<string, string>();
    for (const name of names) aliases.set(this.normalizeName(name), name);
    if (names.length < 2) return aliases;
    try {
      const result = await this.aiService.generateStructuredJson<{
        groups?: Array<{ canonical?: string; aliases?: string[] }>;
      }>(
        '合并同一小说人物、地点、组织的别名。不同实体不得合并。输出 {"groups":[{"canonical":"名称","aliases":["别名"]}]}。',
        names.join('\n'),
        'novel-graph.canonicalize',
        signal,
      );
      for (const group of result.groups ?? []) {
        if (!group.canonical?.trim()) continue;
        aliases.set(this.normalizeName(group.canonical), group.canonical.trim());
        for (const alias of group.aliases ?? []) aliases.set(this.normalizeName(alias), group.canonical.trim());
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `小说实体归一失败，使用确定性名称归一 - 错误: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
    return aliases;
  }

  private extractionPrompt(): string {
    return `从小说章节中抽取有明确原文证据的实体和关系。实体type只能是角色、地点、组织、事件。
关系type只能是参与、位于、隶属于、导致、相关；相关的kind只能是亲属、情侣、盟友、敌对、师徒、竞争、其他。
每个实体和关系必须包含evidenceChunkIds，且只能使用输入方括号中的切片ID。关系包含source、target、type、kind、description、confidence(0到1)。
每个窗口最多输出12个实体和12条关系；只保留原文最明确、置信度最高的事实；description不超过60个汉字。
输出 {"entities":[],"relations":[]}。不要推测未明确出现的事实。`;
  }

  private resolveEntity(
    entities: Map<string, NovelGraphEntity>,
    aliases: Map<string, string>,
    name: string,
    chapterOrdinal: number,
  ): NovelGraphEntity | undefined {
    const canonical = aliases.get(this.normalizeName(name)) ?? name;
    const normalized = this.normalizeName(canonical);
    return (
      [...entities.values()].find(
        (entity) =>
          entity.normalizedName === normalized &&
          (entity.type !== '事件' || entity.id.includes(this.hash(`${normalized}:${chapterOrdinal}`))),
      ) ?? [...entities.values()].find((entity) => entity.normalizedName === normalized)
    );
  }

  private structuralRelation(
    documentId: string,
    sourceId: string,
    targetId: string,
    type: NovelGraphRelation['type'],
    chapterOrdinal: number,
    evidenceChunkIds: string[],
  ): NovelGraphRelation {
    return {
      id: this.stableId(documentId, type, `${sourceId}|${targetId}|${chapterOrdinal}`),
      documentId,
      sourceId,
      targetId,
      type,
      chapterOrdinal,
      confidence: 1,
      evidenceChunkIds,
    };
  }

  private stableId(documentId: string, type: string, key: string): string {
    return `${documentId}:${type.toLowerCase()}:${this.hash(key)}`;
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 24);
  }

  private normalizeName(value: string): string {
    return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  }

  private validEvidence(value: unknown, validIds: Set<string>): string[] {
    return [...new Set(this.stringArray(value).filter((id) => validIds.has(id)))];
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      : [];
  }

  private isEntityType(value: unknown): value is NovelEntityType {
    return ['角色', '地点', '组织', '事件'].includes(String(value));
  }

  private isRelationType(value: unknown): value is NovelGraphRelation['type'] {
    return ['参与', '位于', '隶属于', '导致', '相关'].includes(String(value));
  }

  private isRelationKind(value: unknown): value is CharacterRelationKind {
    return ['亲属', '情侣', '盟友', '敌对', '师徒', '竞争', '其他'].includes(String(value));
  }

  private isValidEndpointPair(
    type: NovelGraphRelation['type'],
    source: NovelEntityType,
    target: NovelEntityType,
  ): boolean {
    const expected: Partial<Record<NovelGraphRelation['type'], [NovelEntityType, NovelEntityType]>> = {
      参与: ['角色', '事件'],
      位于: ['事件', '地点'],
      隶属于: ['角色', '组织'],
      导致: ['事件', '事件'],
      相关: ['角色', '角色'],
    };
    const pair = expected[type];
    return Boolean(pair && pair[0] === source && pair[1] === target);
  }
}
