import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface EmbeddingResult {
  text: string;
  embedding: number[];
  tokenCount: number;
}

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly huggingfaceUrl: string;
  private readonly huggingfaceToken: string;
  private readonly modelName: string;

  constructor(private configService: ConfigService) {
    this.huggingfaceUrl = 'https://api-inference.huggingface.co/pipeline/feature-extraction';
    this.huggingfaceToken = this.configService.get<string>('HUGGING_FACE_TOKEN');
    this.modelName = this.configService.get<string>('EMBEDDING_MODEL') || 'sentence-transformers/all-MiniLM-L6-v2';
  }

  async createEmbedding(text: string): Promise<EmbeddingResult> {
    try {
      this.logger.log(`Creating embedding for text of length ${text.length} using model ${this.modelName}`);
      
      const response = await axios.post(
        `${this.huggingfaceUrl}/${this.modelName}`,
        { inputs: text },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.huggingfaceToken}`,
          },
        },
      );

      // Hugging Face trả về trực tiếp mảng embedding
      const embedding = response.data;

      this.logger.debug(`Successfully created embedding with ${embedding.length} dimensions`);
      
      return {
        text,
        embedding,
        tokenCount: Math.round(text.length / 4), // Ước lượng đơn giản
      };
    } catch (error) {
      this.logger.error(`Error creating embedding with Hugging Face: ${error.message}`);
      throw error;
    }
  }

  async createEmbeddingBatch(texts: string[]): Promise<EmbeddingResult[]> {
    try {
      this.logger.log(`Creating embeddings batch for ${texts.length} texts using model ${this.modelName}`);
      
      // Xử lý từng văn bản một vì Hugging Face có giới hạn về kích thước input
      const results: EmbeddingResult[] = [];
      
      for (const text of texts) {
        try {
          const result = await this.createEmbedding(text);
          results.push(result);
        } catch (error) {
          this.logger.error(`Error processing text: ${error.message}`);
          results.push({
            text,
            embedding: [], // Empty embedding for failed texts
            tokenCount: 0,
          });
        }
      }
      
      this.logger.debug(`Successfully created ${results.length} embeddings`);
      
      return results;
    } catch (error) {
      this.logger.error(`Error creating embeddings batch: ${error.message}`);
      throw error;
    }
  }
}