import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@aws-sdk/node-http-handler';
import * as https from 'https';
import { Document } from '../entities/document.entity';
import { DocumentChunk } from '../entities/document-chunk.entity';
import { AIHubService } from 'src/ai-hub/ai-hub.service';
import { RabbitMQService } from 'rabbitmq/rabbitmq.service';
import { v4 as uuidv4 } from 'uuid';
@Injectable()
export class DocumentProcessingService implements OnModuleInit {
  private readonly logger = new Logger(DocumentProcessingService.name);
  private readonly s3Client: S3Client;

  constructor(
    @InjectRepository(Document)
    private documentRepository: Repository<Document>,
    @InjectRepository(DocumentChunk)
    private chunkRepository: Repository<DocumentChunk>,
    private configService: ConfigService,
    private aiHubService: AIHubService,
    private readonly rabbitMQService: RabbitMQService, // Inject RabbitMQService
  ) {
    this.s3Client = new S3Client({
      region: this.configService.get('aws.region'),
      credentials: {
        accessKeyId: this.configService.get('aws.accessKeyId'),
        secretAccessKey: this.configService.get('aws.secretAccessKey'),
      },
      requestHandler: new NodeHttpHandler({
        httpsAgent: new https.Agent({
          rejectUnauthorized: false,
        }),
      }),
    });
  }

  async onModuleInit() {
    try {
      await this.startProcessing();
      this.logger.log('DocumentProcessingService consumer started.');
    } catch (error) {
      this.logger.error('Error starting DocumentProcessingService consumer:', error.stack);
    }
  }

  async startProcessing() {
    const channel = this.rabbitMQService.getChannel();
    const queue = this.configService.get('rabbitmq.fileProcessingQueue') || 'file-processing-queue';

    await channel.assertQueue(queue, { durable: true });
    this.logger.log(`Waiting for messages in queue ${queue}`);

    channel.consume(queue, async (msg) => {
      if (msg) {
        try {
          const contentString = msg.content.toString();
          this.logger.log(`Received message: ${contentString}`);

          if (!contentString) {
            throw new Error('Message content is empty');
          }

          const { bucket, name } = JSON.parse(contentString);
          this.logger.log(`Processing document:  s3Key = ${bucket}/${name}`);
          const documentId = uuidv4();
          await this.processDocument(documentId, bucket, name);
          this.logger.log(`Successfully processed document: s3Key = ${bucket}/${name}`);
          channel.ack(msg);
        } catch (error) {
          this.logger.error('Error processing message:', error.stack);
          channel.nack(msg, false, true); // Nack và requeue nếu lỗi
        }
      }
    });
  }

  private async processDocument(documentId: string, bucket: string, name: string) {
    this.logger.log(`Starting processDocument for: ${documentId}`);

    try {
      // 1. Tải file từ S3
      const content = await this.getFileFromS3(bucket, `${name}`);
      this.logger.log(`Fetched content from S3 for ${name}, length: ${content.length}`);
      // 2. Lưu document
      const document = await this.documentRepository.save({
        id: documentId,
        filename: name,
        s3Key: `${name}`,
        content,
        status: 'Processing',
      });
      this.logger.log(`Document saved with ID: ${documentId}`);

      // 3. Phân đoạn văn bản
      const chunks = this.splitIntoChunks(content);
      this.logger.log(`Split into ${chunks.length} chunks with content : ${chunks}`);

      // 4. Xử lý từng chunk
      for (const chunk of chunks) {
        const embedding = await this.aiHubService.embeddings(chunk);
        this.logger.log(`Created embedding for chunk, length: ${embedding}`);

        await this.chunkRepository.save({
          content: chunk,
          embedding,
          documentId,
        });
        this.logger.log('Chunk saved.');
      }

      // 5. Cập nhật trạng thái
      await this.documentRepository.update(documentId, { status: 'Indexed' });
      this.logger.log(`Finished processing document with ID: ${documentId}`);
    } catch (error) {
      this.logger.error(`Error processing document ${documentId}: ${error.message}`, error.stack);
      await this.documentRepository.update(documentId, { status: 'Failed' });
      throw error;
    }
  }

  private async getFileFromS3(bucket: string, key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const s3Object = await this.s3Client.send(command);
    // return new Promise((resolve, reject) => {
    //   const chunks: any[] = [];
    //   s3Object.Body.on('data', (chunk) => chunks.push(chunk));
    //   s3Object.Body.on('error', reject);
    //   s3Object.Body.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    // });
    // Hàm chuyển stream thành Buffer
    const streamToBuffer = (stream: any): Promise<Buffer> =>
      new Promise((resolve, reject) => {
        const chunks: any[] = [];
        stream.on('data', (chunk) => {
          chunks.push(chunk);
          this.logger.log('Received chunk of size:', chunk.length);
        });
        stream.on('error', (err) => {
          this.logger.error('Error reading stream:', err);
          reject(err);
        });
        stream.on('end', () => {
          this.logger.log('Stream ended, concatenating chunks');
          resolve(Buffer.concat(chunks));
        });
      });
    const fileBuffer = await streamToBuffer(s3Object.Body);
    this.logger.log(`File converted to Buffer, size: ${fileBuffer.length}`);
    const fileContent = fileBuffer.toString('utf-8');
    this.logger.log(`File content extracted, length: ${fileContent.length}`);
    return fileContent;
  }

  private splitIntoChunks(text: string, maxLength = 1000): string[] {
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
    return chunks;
  }
}
