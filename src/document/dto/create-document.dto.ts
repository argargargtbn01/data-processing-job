import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateDocumentDto {
  @IsNotEmpty()
  @IsString()
  filename: string;

  @IsNotEmpty()
  @IsString()
  s3Key: string;

  @IsOptional()
  @IsString()
  content: string;

  @IsNotEmpty()
  @IsNumber()
  botId: number;

  @IsOptional()
  @IsString()
  mimeType: string;

  @IsOptional()
  @IsNumber()
  fileSize: number;
}