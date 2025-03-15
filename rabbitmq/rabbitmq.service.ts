// rabbitmq.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as amqp from 'amqplib';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private connection: amqp.Connection;
  private channel: amqp.Channel;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    // Khởi tạo connection và channel ngay khi module được khởi tạo
    this.connection = await amqp.connect(this.configService.get('rabbitmq.url'));
    this.channel = await this.connection.createChannel();
    console.log('RabbitMQ connection established.');
  }

  getChannel(): amqp.Channel {
    return this.channel;
  }

  async onModuleDestroy() {
    // Đóng channel và connection khi module bị hủy
    if (this.channel) {
      await this.channel.close();
    }
    if (this.connection) {
      await this.connection.close();
    }
  }
}
