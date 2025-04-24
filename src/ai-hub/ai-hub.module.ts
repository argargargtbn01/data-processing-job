import { Global, Module } from '@nestjs/common';
import { AIHubService } from './ai-hub.service';

@Global()
@Module({
  providers: [AIHubService],
  exports: [AIHubService],
})
export class AIHubModule {}