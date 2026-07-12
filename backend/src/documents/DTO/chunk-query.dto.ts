import { IsUUID } from 'class-validator';
import { PaginationDto } from './pagination.dto';

export class ChunkQueryDto extends PaginationDto {
  @IsUUID()
  documentId!: string;
}
