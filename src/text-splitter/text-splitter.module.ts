import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TextSplitterService } from './text-splitter.service';

@Module({
  imports: [ConfigModule],
  providers: [TextSplitterService],
  exports: [TextSplitterService],
})
export class TextSplitterModule {}