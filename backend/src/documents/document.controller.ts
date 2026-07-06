import { Controller, Post, Get, Delete, Body, Param, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentService } from './document.service';
import { ChunkService } from './chunk.service';
import { FileProcessorService } from '../infrastructure/file-processor/file-processor.service';
import { RustfsService } from '../infrastructure/rustfs/rustfs.service';
import { Document, FileType, DocumentStatus } from '../entities/document.entity';
import { LoggerService } from '../common/logger';

const FILE_TYPE_MAP: Record<string, FileType> = {
  '.pdf': FileType.PDF,
  '.docx': FileType.DOCX,
  '.doc': FileType.DOC,
  '.xlsx': FileType.XLSX,
  '.xls': FileType.XLS,
  '.csv': FileType.CSV,
  '.pptx': FileType.PPTX,
  '.ppt': FileType.PPT,
  '.txt': FileType.TXT,
  '.md': FileType.MD,
  '.json': FileType.JSON,
  '.jpg': FileType.IMAGE,
  '.jpeg': FileType.IMAGE,
  '.png': FileType.IMAGE,
  '.gif': FileType.IMAGE,
  '.webp': FileType.IMAGE,
  '.mp3': FileType.AUDIO,
  '.wav': FileType.AUDIO,
  '.m4a': FileType.AUDIO,
  '.mp4': FileType.VIDEO,
};

@Controller('documents')
export class DocumentController {
  private readonly logger = new LoggerService(DocumentController.name);

  constructor(
    private documentService: DocumentService,
    private chunkService: ChunkService,
    private fileProcessorService: FileProcessorService,
    private rustfsService: RustfsService,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(@UploadedFile() file: Express.Multer.File, @Body() body: { url?: string }) {
    this.logger.debug(
      `请求进入 - 上传文件，文件名: ${file?.originalname || '无'}, URL: ${body.url ? '***URL***' : '无'}`,
    );

    let document: Document;
    let rustfsUrl: string | undefined;

    if (body.url) {
      document = await this.documentService.create({
        name: body.url,
        type: FileType.URL,
        url: body.url,
        status: DocumentStatus.PROCESSING,
      });
    } else if (file) {
      const ext = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf('.'));
      const fileType = FILE_TYPE_MAP[ext] || FileType.TXT;

      document = await this.documentService.create({
        name: file.originalname,
        type: fileType,
        path: '',
        status: DocumentStatus.PROCESSING,
        fileSize: file.size,
      });

      const rustfsKey = `${document.id}/${file.originalname}`;
      rustfsUrl = await this.rustfsService.uploadFile(rustfsKey, file.buffer, file.mimetype);

      await this.documentService.update(document.id, {
        path: rustfsUrl,
      });
    } else {
      throw new Error('No file or URL provided');
    }

    try {
      const filePath = body.url ? body.url : rustfsUrl || file.path;
      const fileName = body.url ? body.url : file.originalname;

      const { text, metadata } = await this.fileProcessorService.processFile(filePath, fileName, document.type);

      await this.documentService.update(document.id, {
        status: DocumentStatus.PROCESSED,
        metadata,
      });

      const chunks = this.fileProcessorService.chunkText(text);
      await this.fileProcessorService.storeChunks(document.id, chunks);
      await this.chunkService.createForDocument(document.id, chunks);

      await this.documentService.update(document.id, {
        chunkCount: chunks.length,
      });

      this.logger.info(`请求成功 - 文件上传完成，文档ID: ${document.id}, 分块数: ${chunks.length}`);

      return {
        success: true,
        data: await this.documentService.findByIdWithChunks(document.id),
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const stackTrace = error instanceof Error ? error.stack : undefined;

      this.logger.error(`请求处理异常 - 文件上传失败，文档ID: ${document.id}，错误: ${errorMessage}`, stackTrace);

      await this.documentService.update(document.id, {
        status: DocumentStatus.FAILED,
        errorMessage,
      });
      throw new Error(`File processing failed: ${errorMessage}`);
    }
  }

  @Get()
  async listDocuments(
    @Query('name') name?: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
  ) {
    this.logger.debug(`请求进入 - 获取文档列表，名称: ${name || '无'}, 页码: ${page}, 每页: ${limit}`);

    const validPage = Math.max(1, page);
    const skip = (validPage - 1) * limit;
    const [documents, total] = await this.documentService.findAll(name, skip, limit);

    this.logger.info(`请求成功 - 获取文档列表完成，总数: ${total}`);

    return {
      success: true,
      data: documents,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  @Get(':id')
  async getDocument(@Param('id') id: string) {
    this.logger.debug(`请求进入 - 获取文档，ID: ${id}`);

    const document = await this.documentService.findByIdWithChunks(id);
    if (!document) {
      this.logger.warn(`文档未找到 - ID: ${id}`);
      throw new Error('Document not found');
    }

    this.logger.info(`请求成功 - 获取文档完成，ID: ${id}`);

    return {
      success: true,
      data: document,
    };
  }

  @Delete(':id')
  async deleteDocument(@Param('id') id: string) {
    this.logger.debug(`请求进入 - 删除文档，ID: ${id}`);

    const document = await this.documentService.findById(id, false);
    if (!document) {
      this.logger.warn(`文档未找到 - ID: ${id}`);
      throw new Error('Document not found');
    }

    await this.documentService.delete(id);

    this.logger.info(`请求成功 - 删除文档完成，ID: ${id}`);

    return {
      success: true,
      message: 'Document deleted successfully',
    };
  }
}
