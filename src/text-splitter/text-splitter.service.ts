import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TextSplitterService {
  private readonly logger = new Logger(TextSplitterService.name);
  private readonly defaultChunkSize: number;
  private readonly defaultChunkOverlap: number;

  constructor(private configService: ConfigService) {
    this.defaultChunkSize = 1000;
    this.defaultChunkOverlap = 200;
  }

  async splitText(
    text: string,
    chunkSize?: number,
    chunkOverlap?: number,
  ): Promise<string[]> {
    this.logger.log(`Splitting text of length ${text?.length || 0}`);

    const size = chunkSize || this.defaultChunkSize;
    const overlap = chunkOverlap || this.defaultChunkOverlap;

    // Đơn giản chỉ sử dụng một phương pháp phân đoạn
    return this.simpleChunk(text, size, overlap);
  }

  private simpleChunk(text: string, chunkSize: number, chunkOverlap: number): string[] {
    const chunks: string[] = [];
    
    if (!text || text.length === 0) {
      return chunks;
    }

    // Phân đoạn theo đoạn văn nếu có thể
    const paragraphs = text.split(/\n\s*\n/);
    let currentChunk = '';
    
    for (const paragraph of paragraphs) {
      // Nếu một đoạn văn đã vượt quá kích thước chunk, phải chia nhỏ nó
      if (paragraph.length > chunkSize) {
        // Xử lý đoạn văn hiện tại nếu có
        if (currentChunk) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }
        
        // Chia đoạn văn dài thành các phần nhỏ hơn
        let startIndex = 0;
        while (startIndex < paragraph.length) {
          const endIndex = Math.min(startIndex + chunkSize, paragraph.length);
          chunks.push(paragraph.substring(startIndex, endIndex).trim());
          startIndex = endIndex - chunkOverlap;
        }
      } 
      // Nếu thêm đoạn văn vào chunk hiện tại sẽ vượt quá kích thước
      else if (currentChunk.length + paragraph.length + 1 > chunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = paragraph;
      } 
      // Nếu có thể thêm đoạn văn vào chunk hiện tại
      else {
        if (currentChunk.length > 0) {
          currentChunk += '\n\n' + paragraph;
        } else {
          currentChunk = paragraph;
        }
      }
    }
    
    // Thêm chunk cuối cùng nếu có
    if (currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
    }
    
    return chunks;
  }
}