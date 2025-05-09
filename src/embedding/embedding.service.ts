import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import * as https from 'https';

export interface EmbeddingResult {
  text: string;
  embedding: number[];
  tokenCount: number;
}

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly googleApiEndpoint: string;
  private readonly googleApiKey: string;
  private readonly retryMax: number;
  private readonly retryDelayMs: number;

  constructor(private configService: ConfigService) {
    this.googleApiEndpoint =
      'https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent';
    this.googleApiKey = this.configService.get<string>('GOOGLE_API_KEY') || '';
    this.retryMax = 3;
    this.retryDelayMs = 1000;
    this.logger.log(`EmbeddingService initialized with Google API`);
  }

  /**
   * Tạo embedding vector cho một đoạn văn bản với cơ chế thử lại
   */
  async createEmbedding(text: string): Promise<EmbeddingResult> {
    try {
      this.logger.log(`Creating embedding for text of length ${text.length}`);

      // Validate input text
      if (!text || text.trim() === '') {
        this.logger.error('Văn bản rỗng không thể tạo embedding');
        throw new Error('Văn bản không được để trống');
      }

      // Sử dụng cơ chế retry để đảm bảo độ tin cậy
      const embedding = await this.withRetry(async () => {
        return this.createEmbeddingWithGoogleAPI(text);
      });

      // Kiểm tra kết quả
      if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
        throw new Error('Embedding không hợp lệ: vector must have at least 1 dimension');
      }

      return {
        text,
        embedding,
        tokenCount: Math.round(text.length / 4), // Ước lượng đơn giản
      };
    } catch (error) {
      this.logger.error(`Error creating embedding: ${error.message}`);
      throw error;
    }
  }

  /**
   * Tạo embeddings cho một batch các đoạn văn bản
   */
  async createEmbeddingBatch(texts: string[]): Promise<EmbeddingResult[]> {
    try {
      this.logger.log(`Creating embeddings batch for ${texts.length} texts`);

      const results: EmbeddingResult[] = [];
      const batchSize = 3; // Xử lý 3 texts mỗi lần để tránh quá tải

      // Chia nhỏ batch để xử lý
      for (let i = 0; i < texts.length; i += batchSize) {
        const batchTexts = texts.slice(i, i + batchSize);

        // Xử lý từng text trong batch nhỏ này
        const batchPromises = batchTexts.map(async (text) => {
          try {
            return await this.createEmbedding(text);
          } catch (error) {
            this.logger.error(`Error processing text: ${error.message}`);
            // Trả về null để lọc sau
            return null;
          }
        });

        // Đợi tất cả promises trong batch nhỏ hoàn thành
        const batchResults = await Promise.all(batchPromises);

        // Lọc ra các kết quả không null và thêm vào mảng kết quả
        results.push(...batchResults.filter((r) => r !== null));

        // Thêm độ trễ giữa các batch
        if (i + batchSize < texts.length) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      this.logger.debug(`Successfully created ${results.length} embeddings`);

      if (results.length === 0) {
        throw new Error('Không tạo được embedding cho bất kỳ văn bản nào trong batch');
      }

      return results;
    } catch (error) {
      this.logger.error(`Error creating embeddings batch: ${error.message}`);
      throw error;
    }
  }

  /**
   * Tạo embedding sử dụng Google Generative Language API
   */
  private async createEmbeddingWithGoogleAPI(text: string): Promise<number[]> {
    try {
      this.logger.debug(`Calling Google API for text of length ${text.length}`);

      // Xây dựng payload đúng định dạng cho Google API
      const payload = {
        content: {
          parts: [{ text }],
        },
      };

      // Sử dụng agent tùy chỉnh để tránh lỗi SSL và tăng timeout
      const httpsAgent = new https.Agent({
        rejectUnauthorized: false,
        keepAlive: true,
        timeout: 30000,
      });

      const config: AxiosRequestConfig = {
        headers: {
          'Content-Type': 'application/json',
        },
        httpsAgent,
        timeout: 30000, // Timeout 30 giây
      };

      const response = await axios.post(
        `${this.googleApiEndpoint}?key=${this.googleApiKey}`,
        payload,
        config,
      );

      // Kiểm tra phản hồi
      this.validateEmbeddingResponse(response);

      // Trích xuất và chuyển đổi embedding
      const embeddings = response.data.embedding.values.map((val) => Number(val));

      this.logger.debug(`Successfully created embedding with ${embeddings.length} dimensions`);
      return embeddings;
    } catch (error) {
      if (error.response) {
        this.logger.error(
          `Google API returned HTTP error ${error.response.status}: ${JSON.stringify(
            error.response.data,
          )}`,
        );
      } else if (error.request) {
        this.logger.error(`No response received from Google API: ${error.message}`);
      } else {
        this.logger.error(`Error setting up request: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Validate response từ Google API
   */
  private validateEmbeddingResponse(response: AxiosResponse): void {
    // Kiểm tra status code
    if (response.status !== 200) {
      throw new Error(`Google API trả về status code không thành công: ${response.status}`);
    }

    // Kiểm tra cấu trúc dữ liệu
    if (!response.data) {
      throw new Error('Phản hồi không có dữ liệu');
    }

    if (!response.data.embedding) {
      throw new Error(`Phản hồi thiếu trường 'embedding': ${JSON.stringify(response.data)}`);
    }

    if (!response.data.embedding.values) {
      throw new Error(
        `Phản hồi thiếu trường 'embedding.values': ${JSON.stringify(response.data.embedding)}`,
      );
    }

    const values = response.data.embedding.values;
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error(`'embedding.values' không phải là mảng hợp lệ: ${JSON.stringify(values)}`);
    }

    // Kiểm tra tất cả các giá trị là số
    const hasInvalidValue = values.some((val) => typeof val !== 'number' && isNaN(Number(val)));
    if (hasInvalidValue) {
      throw new Error('Mảng embedding chứa các giá trị không phải là số');
    }
  }

  /**
   * Hàm helper để thực hiện với cơ chế retry
   */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= this.retryMax; attempt++) {
      try {
        const result = await fn();

        // Kiểm tra nếu result là mảng embedding
        if (Array.isArray(result)) {
          if (result.length === 0) {
            throw new Error('Kết quả là mảng rỗng');
          }
        }

        return result;
      } catch (error) {
        lastError = error;
        this.logger.warn(`Attempt ${attempt}/${this.retryMax} failed: ${error.message}`);

        if (attempt < this.retryMax) {
          const delay = this.retryDelayMs * Math.pow(2, attempt - 1); // Exponential backoff
          this.logger.debug(`Waiting ${delay}ms before retry ${attempt + 1}`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error(`Failed after ${this.retryMax} attempts`);
  }
}
