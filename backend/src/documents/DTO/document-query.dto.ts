import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from './pagination.dto';

export class DocumentQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;
}
