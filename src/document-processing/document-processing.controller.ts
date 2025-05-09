import { Controller, Post, Param, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { DocumentProcessingService } from './document-processing.service';

@Controller('document-processing')
export class DocumentProcessingController {
  private readonly logger = new Logger(DocumentProcessingController.name);

  constructor(private readonly documentProcessingService: DocumentProcessingService) {}

  @Post('sync/:documentId')
  async processSynchronously(@Param('documentId') documentId: string) {
    try {
      this.logger.log(`Received request to process document ${documentId} synchronously`);
      await this.documentProcessingService.processDocumentSync(documentId);
      return { success: true, message: `Document ${documentId} processed successfully` };
    } catch (error) {
      this.logger.error(`Error processing document synchronously: ${error.message}`);
      throw new HttpException(
        { message: `Failed to process document: ${error.message}` },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}