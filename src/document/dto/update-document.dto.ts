import { IsNumber, IsOptional, IsString } from 'class-validator';

export class UpdateDocumentDto {
  @IsOptional()
  @IsString()
  filename?: string;

  @IsOptional()
  @IsString()
  s3Key?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsNumber()
  botId?: number;

  @IsOptional()
  @IsString()
  status?: string;
  
  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsOptional()
  @IsNumber()
  fileSize?: number;
  
  @IsOptional()
  @IsNumber()
  chunkCount?: number;
  
  @IsOptional()
  @IsString()
  processingError?: string;
}