export type NovelEntityType = 'Character' | 'Location' | 'Organization' | 'Event';

export type CharacterRelationKind = 'KINSHIP' | 'ROMANTIC' | 'ALLY' | 'ENEMY' | 'MENTOR' | 'RIVAL' | 'OTHER';

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
  type:
    | 'HAS_CHAPTER'
    | 'NEXT_CHAPTER'
    | 'APPEARS_IN'
    | 'OCCURS_IN'
    | 'MENTIONED_IN'
    | 'PARTICIPATES_IN'
    | 'LOCATED_AT'
    | 'MEMBER_OF'
    | 'CAUSES'
    | 'RELATED_TO';
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
