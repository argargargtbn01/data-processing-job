import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { S3 } from 'aws-sdk';
import { Document } from '../entities/document.entity';
import { DocumentChunk } from 'mos-be/src/shared/entities/document-chunk.entity';
import axios from 'axios';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

@Injectable()
export class DocumentProcessingService {
  private readonly s3: S3;
  private readonly s3Client: S3Client;

  constructor(
    @InjectRepository(Document)
    private documentRepository: Repository<Document>,
    @InjectRepository(DocumentChunk)
    private chunkRepository: Repository<DocumentChunk>,
    private configService: ConfigService,
  ) {
    this.s3 = new S3({
      accessKeyId: this.configService.get('aws.accessKeyId'),
      secretAccessKey: this.configService.get('aws.secretAccessKey'),
      region: this.configService.get('aws.region'),
    });
    this.s3Client = new S3Client({
      region: this.configService.get('aws.region'),
      credentials: {
        accessKeyId: this.configService.get('aws.accessKeyId'),
        secretAccessKey: this.configService.get('aws.secretAccessKey'),
      },
    });
  }

  async startProcessing() {
    const connection = await amqp.connect(this.configService.get('rabbitmq.url'));
    const channel = await connection.createChannel();
    const queue = this.configService.get('rabbitmq.fileProcessingQueue');

    await channel.assertQueue(queue, { durable: true });
    console.log(`Waiting for messages in queue ${queue}`);

    channel.consume(queue, async (msg) => {
      if (msg) {
        try {
          const { fileId, s3Key } = JSON.parse(msg.content.toString());
          await this.processDocument(fileId, s3Key);
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
    // 1. Lấy file từ S3
    const params = {
      Bucket: this.configService.get('aws.s3BucketName'),
      Key: s3Key,
    };
    const command = new GetObjectCommand(params);
    const s3Object = await this.s3Client.send(command);

    // Hàm chuyển stream thành Buffer
    const streamToBuffer = (stream: any): Promise<Buffer> =>
      new Promise((resolve, reject) => {
        const chunks: any[] = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(Buffer.concat(chunks)));
      });

    // Chuyển đổi stream thành Buffer
    const fileBuffer = await streamToBuffer(s3Object.Body);
    // Chuyển Buffer thành chuỗi (UTF-8 là encoding mặc định cho text)
    const fileContent = fileBuffer.toString('utf-8');

    // 2. Lưu document
    const document = await this.documentRepository.save({
      id: fileId,
      filename: s3Key.split('/').pop(),
      s3Key: s3Key,
      content: fileContent,
    });

    // 3. Phân đoạn văn bản
    const chunks = this.splitIntoChunks(document.content);

    // 4. Xử lý từng chunk
    for (const chunkText of chunks) {
      // Tạo embedding cho chunk
      const embedding = await this.createEmbedding(chunkText);

      // Lưu chunk và embedding
      await this.chunkRepository.save({
        content: chunkText,
        embedding: embedding,
        documentId: document.id,
      });
    }
  }

  private splitIntoChunks(text: string, maxLength = 1000): string[] {
    // Phân đoạn theo câu hoặc đoạn văn
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

  private async createEmbedding(text: string): Promise<number[]> {
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

    return response.data[0];
  }
}
