import { Controller, Get, Put, Delete, Param, Body, Query } from '@nestjs/common';
import { ChunkService } from './chunk.service';
import { LoggerService } from '../common/logger';

@Controller('chunks')
export class ChunkController {
  private readonly logger = new LoggerService(ChunkController.name);

  constructor(private chunkService: ChunkService) {}

  @Get()
  async listChunks(
    @Query('documentId') documentId: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
  ) {
    this.logger.debug(`请求进入 - 获取分块列表，文档ID: ${documentId}, 页码: ${page}, 每页: ${limit}`);

    const skip = (page - 1) * limit;
    const [chunks, total] = await this.chunkService.findByDocument(documentId, skip, limit);

    this.logger.info(`请求成功 - 获取分块列表完成，总数: ${total}`);

    return {
      success: true,
      data: chunks,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  @Get(':id')
  async getChunk(@Param('id') id: string) {
    this.logger.debug(`请求进入 - 获取分块，ID: ${id}`);

    const chunk = await this.chunkService.findById(id);
    if (!chunk) {
      this.logger.warn(`分块未找到 - ID: ${id}`);
      throw new Error('Chunk not found');
    }

    this.logger.info(`请求成功 - 获取分块完成，ID: ${id}`);

    return {
      success: true,
      data: chunk,
    };
  }

  @Put(':id')
  async updateChunk(@Param('id') id: string, @Body() body: { content: string }) {
    this.logger.debug(`请求进入 - 更新分块，ID: ${id}`);

    const chunk = await this.chunkService.findById(id);
    if (!chunk) {
      this.logger.warn(`分块未找到 - ID: ${id}`);
      throw new Error('Chunk not found');
    }

    const updated = await this.chunkService.update(id, {
      content: body.content,
    });

    this.logger.info(`请求成功 - 更新分块完成，ID: ${id}`);

    return {
      success: true,
      data: updated,
    };
  }

  @Delete(':id')
  async deleteChunk(@Param('id') id: string) {
    this.logger.debug(`请求进入 - 删除分块，ID: ${id}`);

    const chunk = await this.chunkService.findById(id);
    if (!chunk) {
      this.logger.warn(`分块未找到 - ID: ${id}`);
      throw new Error('Chunk not found');
    }

    await this.chunkService.delete(id);

    this.logger.info(`请求成功 - 删除分块完成，ID: ${id}`);

    return {
      success: true,
      message: 'Chunk deleted successfully',
    };
  }
}
