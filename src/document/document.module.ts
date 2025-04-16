import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document } from '../entities/document.entity';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { S3Service } from '../storage/s3.service';
import { DocumentProcessingModule } from '../document-processing/document-processing.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Document]),
    DocumentProcessingModule,
  ],
  controllers: [DocumentController],
  providers: [DocumentService, S3Service],
  exports: [DocumentService],
})
export class DocumentModule {}