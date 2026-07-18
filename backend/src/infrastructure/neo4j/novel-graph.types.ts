// Neo4j 节点 Label 与关系 Type 均使用中文标识符，Cypher 中需用反引号包裹。
// 约束名 / 索引名保留英文（见 LABEL_KEYS 映射），避免 Neo4j 元数据命名问题。
export type NovelEntityType = '角色' | '地点' | '组织' | '事件';

export type CharacterRelationKind = '亲属' | '情侣' | '盟友' | '敌对' | '师徒' | '竞争' | '其他';

/** 语义关系：由 LLM 从小说文本中抽取，表示实体间的业务关系 */
export const SEMANTIC_RELATION_TYPES = ['参与', '位于', '隶属于', '导致', '相关'] as const;
export type SemanticRelationType = (typeof SEMANTIC_RELATION_TYPES)[number];

/** 结构关系：由程序根据章节结构和实体出现自动生成 */
export const STRUCTURAL_RELATION_TYPES = ['包含章节', '下一章', '出现于', '发生于', '提及于'] as const;
export type StructuralRelationType = (typeof STRUCTURAL_RELATION_TYPES)[number];

/**
 * 语义关系的合法端点类型对矩阵。
 * 每种关系类型允许多组 (sourceType, targetType) 配对，提升 LLM 抽取的存活率。
 * 相关 是兜底类型，允许任意实体配对，不在此矩阵中定义。
 */
export const SEMANTIC_ENDPOINT_PAIRS: Record<string, Array<[NovelEntityType, NovelEntityType]>> = {
  参与: [
    ['角色', '事件'],
    ['组织', '事件'],
  ],
  位于: [
    ['角色', '地点'],
    ['事件', '地点'],
    ['组织', '地点'],
  ],
  隶属于: [
    ['角色', '组织'],
    ['组织', '组织'],
  ],
  导致: [
    ['事件', '事件'],
    ['事件', '角色'],
  ],
  // 相关 为兜底类型，任意两实体均可
};

export interface NovelGraphEntity {
  id: string;
  documentId: string;
  type: NovelEntityType;
  name: string;
  normalizedName: string;
  aliases: string[];
  description?: string;
  evidenceChunkIds: string[];
}

export interface NovelGraphChapter {
  id: string;
  documentId: string;
  ordinal: number;
  title: string;
  evidenceChunkIds: string[];
}

export interface NovelGraphRelation {
  id: string;
  documentId: string;
  sourceId: string;
  targetId: string;
  type: '包含章节' | '下一章' | '出现于' | '发生于' | '提及于' | '参与' | '位于' | '隶属于' | '导致' | '相关';
  kind?: CharacterRelationKind;
  description?: string;
  chapterOrdinal?: number;
  confidence: number;
  evidenceChunkIds: string[];
}

export interface NovelGraphPayload {
  novel: { id: string; documentId: string; title: string };
  chapters: NovelGraphChapter[];
  entities: NovelGraphEntity[];
  relations: NovelGraphRelation[];
  version: string;
}

export interface NovelQueryPlan {
  mode: 'text' | 'graph' | 'hybrid';
  entities: string[];
  relationshipKinds: string[];
  chapterOrdinal?: number;
  novelTitle?: string;
}

export interface GraphEvidence {
  documentId: string;
  documentName: string;
  statement: string;
  evidenceChunkIds: string[];
  confidence: number;
}
