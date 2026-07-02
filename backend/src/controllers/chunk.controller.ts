import { Controller, Get, Put, Delete, Param, Body, Query, HttpException, HttpStatus } from '@nestjs/common';
import { ChunkService } from '../services/chunk.service';

@Controller('chunks')
export class ChunkController {
  constructor(private chunkService: ChunkService) {}

  @Get()
  async listChunks(
    @Query('documentId') documentId: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
  ) {
    const skip = (page - 1) * limit;
    const [chunks, total] = await this.chunkService.findByDocument(documentId, skip, limit);
    
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
    const chunk = await this.chunkService.findById(id);
    if (!chunk) {
      throw new HttpException('Chunk not found', HttpStatus.NOT_FOUND);
    }
    return {
      success: true,
      data: chunk,
    };
  }

  @Put(':id')
  async updateChunk(@Param('id') id: string, @Body() body: { content: string }) {
    const chunk = await this.chunkService.findById(id);
    if (!chunk) {
      throw new HttpException('Chunk not found', HttpStatus.NOT_FOUND);
    }
    
    const updated = await this.chunkService.update(id, { content: body.content });
    return {
      success: true,
      data: updated,
    };
  }

  @Delete(':id')
  async deleteChunk(@Param('id') id: string) {
    const chunk = await this.chunkService.findById(id);
    if (!chunk) {
      throw new HttpException('Chunk not found', HttpStatus.NOT_FOUND);
    }
    
    await this.chunkService.delete(id);
    return {
      success: true,
      message: 'Chunk deleted successfully',
    };
  }
}
