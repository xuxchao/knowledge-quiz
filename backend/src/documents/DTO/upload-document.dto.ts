import { IsOptional, IsUrl } from 'class-validator';

export class UploadDocumentDto {
  @IsOptional()
  @IsUrl({ require_protocol: true })
  url?: string;
}
