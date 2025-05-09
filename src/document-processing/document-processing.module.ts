import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document } from '../entities/document.entity';
import { DocumentProcessingService } from './document-processing.service';
import { DocumentProcessingController } from './document-processing.controller';
import { TextSplitterModule } from '../text-splitter/text-splitter.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { StorageModule } from '../storage/storage.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Document]),
    TextSplitterModule,
    EmbeddingModule,
    StorageModule,
    QueueModule,
  ],
  controllers: [DocumentProcessingController],
  providers: [DocumentProcessingService],
  exports: [DocumentProcessingService],
})
export class DocumentProcessingModule {}
