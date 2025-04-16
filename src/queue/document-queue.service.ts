import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RabbitMQService } from '../../rabbitmq/rabbitmq.service';
import { Channel, ConsumeMessage } from 'amqplib';

export interface DocumentProcessingJob {
  documentId: string;
  botId: number;
  filename: string;
  s3Key: string;
  mimeType?: string;
}

@Injectable()
export class DocumentQueueService implements OnModuleInit {
  private readonly logger = new Logger(DocumentQueueService.name);
  private channel: Channel;
  private static readonly DOCUMENT_QUEUE = 'mos';
  private initialized = false;

  constructor(private readonly rabbitMQService: RabbitMQService) {}

  async onModuleInit() {
    await this.initialize();
  }

  private async initialize() {
    try {
      // Lấy channel từ RabbitMQService
      this.channel = this.rabbitMQService.getChannel();
      
      if (!this.channel) {
        throw new Error('RabbitMQ channel is not available');
      }
      
      // Đảm bảo queue tồn tại
      await this.channel.assertQueue(DocumentQueueService.DOCUMENT_QUEUE, { durable: true });
      
      this.initialized = true;
      this.logger.log('Document queue service initialized successfully');
    } catch (error) {
      this.logger.error(`Error initializing document queue service: ${error.message}`);
      throw error;
    }
  }

  private async ensureInitialized() {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  async addDocumentProcessingJob(job: DocumentProcessingJob) {
    try {
      await this.ensureInitialized();
      
      this.logger.log(`Adding document processing job for documentId: ${job.documentId}`);
      await this.channel.sendToQueue(
        DocumentQueueService.DOCUMENT_QUEUE,
        Buffer.from(JSON.stringify(job)),
        { persistent: true }
      );
      this.logger.log(`Successfully added document processing job for documentId: ${job.documentId}`);
    } catch (error) {
      this.logger.error(`Error adding document processing job: ${error.message}`);
      throw error;
    }
  }

  async consumeDocumentQueue(callback: (job: DocumentProcessingJob) => Promise<void>) {
    try {
      await this.ensureInitialized();
      
      await this.channel.consume(
        DocumentQueueService.DOCUMENT_QUEUE,
        async (msg: ConsumeMessage | null) => {
          if (msg) {
            try {
              const job: DocumentProcessingJob = JSON.parse(msg.content.toString());
              this.logger.log(`Processing document job: ${job.documentId}`);
              await callback(job);
              this.channel.ack(msg);
            } catch (error) {
              this.logger.error(`Error processing document job: ${error.message}`);
              // Nếu lỗi, đẩy lại vào hàng đợi sau một thời gian
              this.channel.nack(msg, false, true);
            }
          }
        },
        { noAck: false }
      );
    } catch (error) {
      this.logger.error(`Error consuming document queue: ${error.message}`);
      throw error;
    }
  }
}