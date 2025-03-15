import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DocumentProcessingService } from './document-processing.service';
import { Document } from '../entities/document.entity';
import { DocumentChunk } from 'src/entities/document-chunk.entity';
import { RabbitMQModule } from 'rabbitmq/rabbitmq.module';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([Document, DocumentChunk]), RabbitMQModule],
  providers: [DocumentProcessingService],
  exports: [DocumentProcessingService],
})
export class DocumentProcessingModule {}
