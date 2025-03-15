import { Global, Module } from '@nestjs/common';
import { RabbitMQService } from './rabbitmq.service';

@Global() // Đánh dấu module này là global
@Module({
  providers: [RabbitMQService],
  exports: [RabbitMQService],
})
export class RabbitMQModule {}
