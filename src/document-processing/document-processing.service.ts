import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { Document } from '../entities/document.entity';

import axios from 'axios';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { RabbitMQService } from 'rabbitmq/rabbitmq.service';
import { DocumentChunk } from 'src/entities/document-chunk.entity';

@Injectable()
export class DocumentProcessingService implements OnModuleInit {
  private readonly s3Client: S3Client;

  constructor(
    @InjectRepository(Document)
    private documentRepository: Repository<Document>,
    @InjectRepository(DocumentChunk)
    private chunkRepository: Repository<DocumentChunk>,
    private configService: ConfigService,
    private readonly rabbitMQService: RabbitMQService, // Inject RabbitMQService
  ) {
    this.s3Client = new S3Client({
      region: this.configService.get('aws.region'),
      credentials: {
        accessKeyId: this.configService.get('aws.accessKeyId'),
        secretAccessKey: this.configService.get('aws.secretAccessKey'),
      },
    });
  }

  async onModuleInit() {
    // Trigger tự động khi module được khởi tạo
    try {
      await this.startProcessing();
      console.log('DocumentProcessingService consumer started.');
    } catch (error) {
      console.error('Error starting DocumentProcessingService consumer:', error);
    }
  }

  async startProcessing() {
    const channel = this.rabbitMQService.getChannel();
    const queue = this.configService.get('rabbitmq.fileProcessingQueue');

    await channel.assertQueue(queue, { durable: true });
    console.log(`Waiting for messages in queue ${queue}`);

    channel.consume(queue, async (msg) => {
      if (msg) {
        try {
          console.log('Received message:', msg.content.toString());
          const { fileId, s3Key } = JSON.parse(msg.content.toString());
          console.log(`Processing document: fileId = ${fileId}, s3Key = ${s3Key}`);
          await this.processDocument(fileId, s3Key);
          console.log(`Successfully processed document: fileId = ${fileId}`);
          channel.ack(msg);
        } catch (error) {
          console.error('Error processing message:', error);
          // Nack và requeue message nếu xử lý thất bại
          channel.nack(msg, false, true);
        }
      }
    });
  }

  private async processDocument(fileId: string, s3Key: string) {
    console.log(`Starting processDocument for fileId: ${fileId} with s3Key: ${s3Key}`);

    // 1. Lấy file từ S3
    const params = {
      Bucket: this.configService.get('aws.s3BucketName'),
      Key: s3Key,
    };
    console.log('Fetching file from S3 with params:', params);
    const command = new GetObjectCommand(params);
    const s3Object = await this.s3Client.send(command);

    console.log('File fetched from S3');

    // Hàm chuyển stream thành Buffer
    const streamToBuffer = (stream: any): Promise<Buffer> =>
      new Promise((resolve, reject) => {
        const chunks: any[] = [];
        stream.on('data', (chunk) => {
          chunks.push(chunk);
          console.log('Received chunk of size:', chunk.length);
        });
        stream.on('error', (err) => {
          console.error('Error reading stream:', err);
          reject(err);
        });
        stream.on('end', () => {
          console.log('Stream ended, concatenating chunks');
          resolve(Buffer.concat(chunks));
        });
      });

    // Chuyển đổi stream thành Buffer
    const fileBuffer = await streamToBuffer(s3Object.Body);
    console.log('File converted to Buffer, size:', fileBuffer.length);
    // Chuyển Buffer thành chuỗi (UTF-8 là encoding mặc định cho text)
    const fileContent = fileBuffer.toString('utf-8');
    console.log('File content extracted, length:', fileContent.length);

    // 2. Lưu document
    console.log('Saving document to database...');
    const document = await this.documentRepository.save({
      id: fileId,
      filename: s3Key.split('/').pop(),
      s3Key: s3Key,
      content: fileContent,
    });
    console.log('Document saved with ID:', document.id);

    // 3. Phân đoạn văn bản
    console.log('Splitting document content into chunks...');
    const chunks = this.splitIntoChunks(document.content);
    console.log(`Document split into ${chunks.length} chunks.`);

    // 4. Xử lý từng chunk
    for (const chunkText of chunks) {
      console.log('Processing chunk (first 50 chars):', chunkText.substring(0, 50));
      // Tạo embedding cho chunk
      const embedding = await this.createEmbedding(chunkText);
      console.log('Embedding created for chunk, length:', embedding.length);
      // Lưu chunk và embedding
      await this.chunkRepository.save({
        content: chunkText,
        embedding: embedding,
        documentId: document.id,
      });
      console.log('Chunk saved.');
    }

    console.log(`Finished processing document with ID: ${fileId}`);
  }

  private splitIntoChunks(text: string, maxLength = 1000): string[] {
    console.log('Splitting text into chunks with max length:', maxLength);
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    const chunks: string[] = [];
    let currentChunk = '';

    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length > maxLength && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
      currentChunk += sentence + ' ';
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
    }
    console.log('Total chunks created:', chunks.length);
    return chunks;
  }

  private async createEmbedding(text: string): Promise<number[]> {
    console.log('Creating embedding for text of length:', text.length);
    interface HuggingFaceResponse {
      data: number[];
    }

    const response = await axios.post<HuggingFaceResponse>(
      'https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2',
      { inputs: text },
      {
        headers: {
          Authorization: `Bearer ${this.configService.get('HUGGING_FACE_TOKEN')}`,
          'Content-Type': 'application/json',
        },
      },
    );
    console.log('Received embedding from HuggingFace.');
    return response.data[0];
  }
}
