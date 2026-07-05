import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  UploadedFile,
  UseInterceptors,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentService } from './document.service';
import { FileProcessorService } from '../infrastructure/file-processor/file-processor.service';
import { RustfsService } from '../infrastructure/rustfs/rustfs.service';
import { Document, FileType, DocumentStatus } from '../entities/document.entity';

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
  private readonly logger = new Logger(DocumentController.name);

  constructor(
    private documentService: DocumentService,
    private fileProcessorService: FileProcessorService,
    private rustfsService: RustfsService,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(@UploadedFile() file: Express.Multer.File, @Body() body: { url?: string }) {
    this.logger.debug(
      `[uploadFile] 开始处理文件上传请求 - file: ${file ? file.originalname : 'undefined'}, url: ${body.url ? '***URL***' : 'undefined'}, file.path: ${file ? file.path : 'undefined'}`,
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
      this.logger.debug(
        `[uploadFile] 进入文件处理流程 - body.url: ${body.url ? '***URL***' : 'undefined'}, rustfsUrl: ${rustfsUrl ? '***REDACTED***' : 'undefined'}, document.id: ${document.id}, document.type: ${document.type}`,
      );

      const filePath = body.url ? body.url : rustfsUrl || file.path;
      const fileName = body.url ? body.url : file.originalname;

      this.logger.debug(
        `[uploadFile] 文件路径处理完成 - filePath: ${filePath ? '***REDACTED***' : 'undefined'}, fileName: ${fileName ? fileName.substring(0, 50) + (fileName.length > 50 ? '...' : '') : 'undefined'}, document.type: ${document.type}`,
      );

      const { text, metadata } = await this.fileProcessorService.processFile(filePath, fileName, document.type);

      await this.documentService.update(document.id, {
        status: DocumentStatus.PROCESSED,
        metadata,
      });

      const chunks = this.fileProcessorService.chunkText(text);
      await this.fileProcessorService.storeChunks(document.id, chunks);

      await this.documentService.update(document.id, {
        chunkCount: chunks.length,
      });

      this.logger.debug(`[uploadFile] 文件处理完成 - document.id: ${document.id}, chunkCount: ${chunks.length}`);

      return {
        success: true,
        data: await this.documentService.findByIdWithChunks(document.id),
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const stackTrace = error instanceof Error ? error.stack : undefined;

      this.logger.error(`[uploadFile] 文件处理失败 - document.id: ${document.id}, error: ${errorMessage}`, stackTrace);

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
    const validPage = Math.max(1, page);
    const skip = (validPage - 1) * limit;
    const [documents, total] = await this.documentService.findAll(name, skip, limit);

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
    const document = await this.documentService.findByIdWithChunks(id);
    if (!document) {
      throw new Error('Document not found');
    }
    return {
      success: true,
      data: document,
    };
  }

  @Delete(':id')
  async deleteDocument(@Param('id') id: string) {
    const document = await this.documentService.findById(id, false);
    if (!document) {
      throw new Error('Document not found');
    }

    await this.documentService.delete(id);
    return {
      success: true,
      message: 'Document deleted successfully',
    };
  }
}
