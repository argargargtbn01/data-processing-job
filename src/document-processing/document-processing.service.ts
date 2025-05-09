import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Document } from '../entities/document.entity';
import { TextSplitterService } from '../text-splitter/text-splitter.service';
import { S3Service } from '../storage/s3.service';
import { DocumentQueueService, DocumentProcessingJob } from '../queue/document-queue.service';
import { EmbeddingService } from '../embedding/embedding.service';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as util from 'util';

const writeFile = util.promisify(fs.writeFile);
const unlink = util.promisify(fs.unlink);
const mkdir = util.promisify(fs.mkdir);

@Injectable()
export class DocumentProcessingService implements OnModuleInit {
  private readonly logger = new Logger(DocumentProcessingService.name);
  private tempDir: string;
  private readonly dataHubUrl: string;

  constructor(
    @InjectRepository(Document)
    private documentRepository: Repository<Document>,
    private textSplitterService: TextSplitterService,
    private s3Service: S3Service,
    private documentQueueService: DocumentQueueService,
    private embeddingService: EmbeddingService,
    private configService: ConfigService,
  ) {
    this.tempDir = path.join(os.tmpdir(), 'document-processing');
    this.dataHubUrl =
      this.configService.get<string>('DATA_HUB_URL') || 'http://quang1709.ddns.net:3002'; // Sử dụng port 3002 cho data-hub
    this.ensureTempDir();
  }

  async onModuleInit() {
    // Khởi tạo consumer cho document processing queue
    await this.documentQueueService.consumeDocumentQueue(
      async (job) => await this.processDocumentJob(job),
    );
  }

  private async ensureTempDir() {
    try {
      if (!fs.existsSync(this.tempDir)) {
        await mkdir(this.tempDir, { recursive: true });
      }
    } catch (error) {
      this.logger.error(`Error creating temp directory: ${error.message}`);
      throw error;
    }
  }

  async processDocument(documentId: string): Promise<void> {
    try {
      const document = await this.documentRepository.findOne({
        where: { id: documentId },
      });

      if (!document) {
        throw new Error(`Document with ID ${documentId} not found`);
      }

      // Cập nhật trạng thái tài liệu
      document.status = 'Processing';
      await this.documentRepository.save(document);

      // Thêm document vào queue
      await this.documentQueueService.addDocumentProcessingJob({
        documentId: document.id,
        botId: document.botId,
        filename: document.filename,
        s3Key: document.s3Key,
        mimeType: document.mimeType,
      });

      this.logger.log(`Document ${documentId} added to processing queue`);
    } catch (error) {
      this.logger.error(`Error initiating document processing: ${error.message}`);
      await this.updateDocumentStatus(documentId, 'Error', error.message);
      throw error;
    }
  }

  /**
   * Xử lý tài liệu đồng bộ không thông qua queue
   */
  async processDocumentSync(documentId: string): Promise<void> {
    try {
      this.logger.log(`Starting synchronous document processing for document ${documentId}`);

      const document = await this.documentRepository.findOne({
        where: { id: documentId },
      });

      if (!document) {
        throw new Error(`Document with ID ${documentId} not found`);
      }

      // Cập nhật trạng thái tài liệu
      document.status = 'Processing';
      await this.documentRepository.save(document);

      // Tạo job tương tự như từ queue
      const job: DocumentProcessingJob = {
        documentId: document.id,
        botId: document.botId,
        filename: document.filename,
        s3Key: document.s3Key,
        mimeType: document.mimeType,
      };

      // Xử lý tài liệu trực tiếp mà không qua queue
      await this.processDocumentJob(job);

      this.logger.log(`Synchronous document processing completed for document ${documentId}`);
    } catch (error) {
      this.logger.error(`Error processing document synchronously: ${error.message}`);
      await this.updateDocumentStatus(documentId, 'Error', error.message);
      throw error;
    }
  }

  private async processDocumentJob(job: DocumentProcessingJob): Promise<void> {
    try {
      this.logger.log(`Starting complete document processing for document ${job.documentId}`);

      // BƯỚC 1: Tải tài liệu từ S3
      this.logger.log(`Downloading document from S3: ${job.s3Key}`);
      const fileBuffer = await this.s3Service.getFile(job.s3Key);

      // Check if the file exists in S3
      if (!fileBuffer) {
        this.logger.warn(`File does not exist in S3: ${job.s3Key}`);
        await this.updateDocumentStatus(
          job.documentId,
          'Error',
          `The file does not exist in S3 bucket: ${job.s3Key}`,
        );
        return; // Exit the method early
      }

      // BƯỚC 2: Trích xuất nội dung từ tài liệu trực tiếp từ buffer
      this.logger.log(`Extracting text from document: ${job.filename}`);
      const extractedText = await this.extractTextFromBuffer(fileBuffer, job.filename);

      // Cập nhật nội dung cho document
      await this.updateDocumentContent(job.documentId, extractedText);

      // BƯỚC 3: Phân đoạn văn bản - chỉ dùng một phương pháp duy nhất
      this.logger.log(`Splitting document into chunks`);
      const chunks = await this.textSplitterService.splitText(extractedText);

      // Cập nhật số lượng chunks vào document
      await this.updateDocumentChunkCount(job.documentId, chunks.length);

      // BƯỚC 4: Xử lý từng chunk và lưu trữ
      this.logger.log(`Processing ${chunks.length} chunks for document ${job.documentId}`);

      // Xử lý hàng loạt các chunks thay vì từng cái một - giảm kích thước batch
      const chunkBatchSize = 3; // Giảm từ 5 xuống 3 để giảm tải cho API
      let failedChunks = 0;

      for (let i = 0; i < chunks.length; i += chunkBatchSize) {
        const batchChunks = chunks.slice(i, i + chunkBatchSize);

        try {
          // Tạo embeddings cho cả batch
          const embeddings = await this.embeddingService.createEmbeddingBatch(batchChunks);

          // Lưu từng chunk với embedding vào data-hub
          for (let j = 0; j < embeddings.length; j++) {
            const chunkIndex = i + j;
            const { embedding, text } = embeddings[j];

            // Kiểm tra embedding trước khi lưu
            if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
              this.logger.warn(`Invalid embedding for chunk ${chunkIndex}, retrying...`);
              try {
                // Thử lại với cơ chế retry
                const retryEmbedding = await this.createEmbeddingWithRetry(text);
                await this.saveChunkToDataHubWithRetry({
                  documentId: job.documentId,
                  botId: job.botId,
                  filename: job.filename,
                  chunkIndex: chunkIndex,
                  totalChunks: chunks.length,
                  text: text,
                  embedding: retryEmbedding,
                });
              } catch (error) {
                this.logger.error(
                  `Failed to create embedding for chunk ${chunkIndex} after retries: ${error.message}`,
                );
                failedChunks++;
              }
            } else {
              await this.saveChunkToDataHubWithRetry({
                documentId: job.documentId,
                botId: job.botId,
                filename: job.filename,
                chunkIndex: chunkIndex,
                totalChunks: chunks.length,
                text: text,
                embedding: embedding,
              });
            }
          }

          this.logger.log(
            `Processed chunks ${i + 1} to ${Math.min(i + chunkBatchSize, chunks.length)} of ${
              chunks.length
            }`,
          );

          // Thêm độ trễ giữa các batch để tránh quá tải API
          if (i + chunkBatchSize < chunks.length) {
            this.logger.debug('Adding delay between batches to avoid API rate limiting');
            await new Promise((resolve) => setTimeout(resolve, 1000)); // 1s delay
          }
        } catch (error) {
          this.logger.error(`Error processing batch starting at chunk ${i}: ${error.message}`);
          failedChunks += batchChunks.length;
        }
      }

      // Báo cáo về các chunks thất bại
      if (failedChunks > 0) {
        this.logger.warn(
          `Document ${job.documentId} processed with ${failedChunks}/${chunks.length} failed chunks`,
        );
        await this.updateDocumentStatus(
          job.documentId,
          'Processed with errors',
          `${failedChunks} chunks failed to process`,
        );
      } else {
        // Cập nhật trạng thái tài liệu thành công
        await this.updateDocumentStatus(job.documentId, 'Processed');
        this.logger.log(`Document ${job.documentId} processed successfully`);
      }

      // Xác minh xem tất cả các chunks có được lưu đúng không
      await this.verifyDocumentProcessed(job.documentId, job.botId, chunks.length);
    } catch (error) {
      this.logger.error(`Error processing document: ${error.message}`);
      await this.updateDocumentStatus(job.documentId, 'Error', error.message);
      throw error;
    }
  }

  private async createEmbeddingWithRetry(text: string, maxRetries = 3): Promise<number[]> {
    let retries = 0;
    let lastError;

    while (retries < maxRetries) {
      try {
        this.logger.debug(`Creating embedding attempt ${retries + 1}/${maxRetries}`);
        const embedding = await this.embeddingService.createEmbedding(text);

        // Kiểm tra embedding có hợp lệ không
        if (embedding && Array.isArray(embedding) && embedding.length > 0) {
          this.logger.debug(
            `Successfully created embedding with ${embedding.length} dimensions on attempt ${
              retries + 1
            }`,
          );
          return embedding;
        }

        throw new Error('Embedding is empty or invalid');
      } catch (error) {
        lastError = error;
        retries++;
        this.logger.warn(`Embedding attempt ${retries}/${maxRetries} failed: ${error.message}`);

        // Tăng thời gian chờ theo cấp số nhân
        const delayMs = 1000 * Math.pow(2, retries - 1); // 1s, 2s, 4s
        this.logger.debug(`Waiting ${delayMs}ms before retry`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw lastError || new Error(`Failed to create embedding after ${maxRetries} attempts`);
  }

  private async saveChunkToDataHubWithRetry(
    chunkData: {
      documentId: string;
      botId: number;
      filename: string;
      chunkIndex: number;
      totalChunks: number;
      text: string;
      embedding: number[];
    },
    maxRetries = 3,
  ): Promise<void> {
    let retries = 0;
    let lastError;

    // Kiểm tra embedding hợp lệ trước khi thử lưu
    if (
      !chunkData.embedding ||
      !Array.isArray(chunkData.embedding) ||
      chunkData.embedding.length === 0
    ) {
      throw new Error('Invalid embedding: vector must have at least 1 dimension');
    }

    while (retries < maxRetries) {
      try {
        // Thêm metadata quan trọng cho việc tìm kiếm RAG sau này
        const enhancedChunkData = {
          ...chunkData,
          metadata: {
            source: chunkData.filename,
            documentId: chunkData.documentId,
            chunkIndex: chunkData.chunkIndex,
            createdAt: new Date().toISOString(),
          },
        };

        // Gọi API của data-hub để lưu chunk
        const response = await axios.post(
          `${this.dataHubUrl}/vector-store/chunk`,
          enhancedChunkData,
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000, // 10 giây timeout
          },
        );

        // Kiểm tra phản hồi để đảm bảo chunk đã được lưu đúng
        if (response.status !== 201 && response.status !== 200) {
          throw new Error(`Unexpected response status: ${response.status}`);
        }

        this.logger.log(
          `Saved chunk ${chunkData.chunkIndex + 1}/${chunkData.totalChunks} for document ${
            chunkData.documentId
          } to data-hub successfully`,
        );

        return; // Thoát khỏi vòng lặp nếu thành công
      } catch (error) {
        lastError = error;
        retries++;

        this.logger.error(
          `Error saving chunk to data-hub (attempt ${retries}/${maxRetries}): ${error.message}`,
        );

        if (retries >= maxRetries) {
          break;
        }

        // Tăng thời gian chờ theo cấp số nhân
        const delayMs = 1000 * Math.pow(2, retries - 1); // 1s, 2s, 4s
        this.logger.debug(`Waiting ${delayMs}ms before retry saving chunk`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    // Nếu không thành công sau nhiều lần thử, ném lỗi
    throw lastError || new Error(`Failed to save chunk after ${maxRetries} attempts`);
  }

  private async verifyDocumentProcessed(
    documentId: string,
    botId: number,
    expectedChunks: number,
  ): Promise<void> {
    try {
      this.logger.log(`Verifying document ${documentId} processing...`);

      // Gọi API kiểm tra số lượng chunks đã được lưu
      const response = await axios.get(
        `${this.dataHubUrl}/vector-store/document/${documentId}/chunks-count`,
        {
          params: { botId },
          timeout: 5000,
        },
      );

      const savedChunks = response.data?.count || 0;

      if (savedChunks < expectedChunks) {
        this.logger.warn(
          `Document ${documentId} verification: Found only ${savedChunks}/${expectedChunks} chunks. Some chunks might be missing.`,
        );
      } else {
        this.logger.log(
          `Document ${documentId} verification successful: All ${savedChunks} chunks saved.`,
        );
      }
    } catch (error) {
      this.logger.error(`Error verifying document processing: ${error.message}`);
    }
  }

  private async saveChunkToDataHub(chunkData: {
    documentId: string;
    botId: number;
    filename: string;
    chunkIndex: number;
    totalChunks: number;
    text: string;
    embedding: number[];
  }): Promise<void> {
    try {
      // Thêm metadata quan trọng cho việc tìm kiếm RAG sau này
      const enhancedChunkData = {
        ...chunkData,
        metadata: {
          source: chunkData.filename,
          documentId: chunkData.documentId,
          chunkIndex: chunkData.chunkIndex,
          createdAt: new Date().toISOString(),
        },
      };

      // Gọi API của data-hub để lưu chunk
      await axios.post(`${this.dataHubUrl}/vector-store/chunk`, enhancedChunkData, {
        headers: { 'Content-Type': 'application/json' },
      });

      this.logger.log(
        `Saved chunk ${chunkData.chunkIndex + 1}/${chunkData.totalChunks} for document ${
          chunkData.documentId
        } to data-hub`,
      );
    } catch (error) {
      this.logger.error(`Error saving chunk to data-hub: ${error.message}`);

      // Log more specific information about the data-hub endpoint
      if (error.response?.status === 404) {
        this.logger.warn(
          `Data-hub endpoint not found at ${this.dataHubUrl}/vector-store/chunk. Make sure the data-hub service is running and has this endpoint.`,
        );
      }

      // Re-throw the error to be caught by the calling method
      throw error;
    }
  }

  private async extractTextFromBuffer(fileBuffer: Buffer, filename: string): Promise<string> {
    try {
      // Trích xuất text từ buffer dựa vào loại file
      const extension = path.extname(filename).toLowerCase();
      this.logger.log(`Extracting text from buffer for ${filename} with extension ${extension}`);

      let textContent = '';

      // Đơn giản hóa việc xử lý file - không dùng thư viện bên ngoài nếu có thể
      try {
        // Đối với mọi loại file, trước tiên cố gắng chuyển buffer thành string
        textContent = fileBuffer.toString('utf8');

        // Loại bỏ các ký tự null
        textContent = textContent.replace(/\0/g, '');

        // Nếu không có nội dung hoặc nội dung chỉ chứa ký tự không phải chữ cái/số
        if (!textContent || textContent.trim() === '') {
          this.logger.warn(`Empty content extracted from ${filename}, returning blank text`);
        }
      } catch (err) {
        this.logger.error(`Error extracting text from buffer: ${err.message}`);
        textContent = `Could not extract text from ${filename}: ${err.message}`;
      }

      return textContent;
    } catch (error) {
      this.logger.error(`Error in extractTextFromBuffer: ${error.message}`);
      // Trả về chuỗi rỗng trong trường hợp lỗi để tránh lỗi null
      return '';
    }
  }

  private async extractTextFromFile(filePath: string, filename: string): Promise<string> {
    try {
      // Trích xuất text từ file dựa vào loại file
      const extension = path.extname(filename).toLowerCase();
      this.logger.log(`Extracting text from ${filename} with extension ${extension}`);

      // Xử lý theo định dạng file
      switch (extension) {
        case '.docx':
        case '.doc':
          try {
            const mammoth = require('mammoth');
            const result = await mammoth.extractRawText({ path: filePath });
            return result.value || '';
          } catch (err) {
            this.logger.error(`Error processing Word file with mammoth: ${err.message}`);
            return `Error extracting text from ${filename}: ${err.message}`;
          }

        case '.txt':
          return fs.readFileSync(filePath, 'utf8');

        case '.csv':
          const content = fs.readFileSync(filePath, 'utf8');
          return content;

        default:
          this.logger.warn(`Unsupported file type: ${extension}, processing as text`);
          return fs.readFileSync(filePath, 'utf8');
      }
    } catch (error) {
      this.logger.error(`Error extracting text from file: ${error.message}`);
      throw error;
    }
  }

  private async updateDocumentContent(documentId: string, content: string): Promise<void> {
    try {
      // Loại bỏ các ký tự null (0x00) trước khi lưu vào database
      const sanitizedContent = content ? content.replace(/\0/g, '') : '';
      await this.documentRepository.update(documentId, { content: sanitizedContent });
    } catch (error) {
      this.logger.error(`Error updating document content: ${error.message}`);
      throw error;
    }
  }

  private async updateDocumentChunkCount(documentId: string, chunkCount: number): Promise<void> {
    try {
      await this.documentRepository.update(documentId, { chunkCount });
    } catch (error) {
      this.logger.error(`Error updating document chunk count: ${error.message}`);
      throw error;
    }
  }

  private async updateDocumentStatus(
    documentId: string,
    status: string,
    errorMessage?: string,
  ): Promise<void> {
    try {
      await this.documentRepository.update(documentId, {
        status,
        processingError: errorMessage || null,
      });
    } catch (error) {
      this.logger.error(`Error updating document status: ${error.message}`);
      throw error;
    }
  }
}
