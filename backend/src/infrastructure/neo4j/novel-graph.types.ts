// Neo4j 节点 Label 与关系 Type 均使用中文标识符，Cypher 中需用反引号包裹。
// 约束名 / 索引名保留英文（见 LABEL_KEYS 映射），避免 Neo4j 元数据命名问题。
export type NovelEntityType = '角色' | '地点' | '组织' | '事件';

export type CharacterRelationKind = '亲属' | '情侣' | '盟友' | '敌对' | '师徒' | '竞争' | '其他';

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
