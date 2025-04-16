import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Document } from '../entities/document.entity';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { S3Service } from '../storage/s3.service';
import { DocumentProcessingService } from '../document-processing/document-processing.service';
import * as path from 'path';
import { randomUUID } from 'crypto';

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);

  constructor(
    @InjectRepository(Document)
    private documentRepository: Repository<Document>,
    private s3Service: S3Service,
    private documentProcessingService: DocumentProcessingService,
  ) {}

  async create(createDocumentDto: CreateDocumentDto): Promise<Document> {
    const document = this.documentRepository.create(createDocumentDto);
    return this.documentRepository.save(document);
  }

  async uploadFile(file: Express.Multer.File, botId: number): Promise<Document> {
    try {
      this.logger.log(`Processing file upload: ${file.originalname} for botId: ${botId}`);
      
      // Generate unique filename for S3
      const fileExtension = path.extname(file.originalname);
      const uniqueFilename = `${randomUUID()}${fileExtension}`;
      const s3Key = `documents/${botId}/${uniqueFilename}`;
      
      // Upload file to S3
      await this.s3Service.uploadFile(s3Key, file.buffer, file.mimetype);
      
      // Create document record in database
      const document = this.documentRepository.create({
        botId: botId,
        filename: file.originalname,
        s3Key: s3Key,
        mimeType: file.mimetype,
        status: 'Pending',
        fileSize: file.size,
        content: '', // Thêm giá trị mặc định cho content để tránh lỗi not-null constraint
      });
      
      const savedDocument = await this.documentRepository.save(document);
      
      // Trigger document processing
      await this.documentProcessingService.processDocument(savedDocument.id);
      
      return savedDocument;
    } catch (error) {
      this.logger.error(`Error uploading file: ${error.message}`);
      throw error;
    }
  }

  async findAll(botId?: number): Promise<Document[]> {
    if (botId) {
      return this.documentRepository.find({ where: { botId } });
    }
    return this.documentRepository.find();
  }

  async findOne(id: string): Promise<Document> {
    const document = await this.documentRepository.findOne({ where: { id } });
    if (!document) {
      throw new NotFoundException(`Document with ID "${id}" not found`);
    }
    return document;
  }

  async update(id: string, updateDocumentDto: UpdateDocumentDto): Promise<Document> {
    const document = await this.findOne(id);
    Object.assign(document, updateDocumentDto);
    return this.documentRepository.save(document);
  }

  async remove(id: string): Promise<void> {
    const document = await this.findOne(id);
    await this.documentRepository.remove(document);
  }

  async updateStatus(id: string, status: string, error?: string): Promise<Document> {
    const document = await this.findOne(id);
    document.status = status;
    if (error) {
      document.processingError = error;
    }
    return this.documentRepository.save(document);
  }

  async findByBotId(botId: number): Promise<Document[]> {
    return this.documentRepository.find({ where: { botId } });
  }
}