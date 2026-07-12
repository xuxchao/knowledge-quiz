import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UpdateChunkDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100_000)
  content!: string;
}
