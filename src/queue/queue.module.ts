import { Module } from '@nestjs/common';
import { RabbitMQModule } from '../../rabbitmq/rabbitmq.module';
import { DocumentQueueService } from './document-queue.service';

@Module({
  imports: [RabbitMQModule],
  providers: [DocumentQueueService],
  exports: [DocumentQueueService],
})
export class QueueModule {}