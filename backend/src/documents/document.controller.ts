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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentService } from './document.service';
import { FileProcessorService } from '../infrastructure/file-processor/file-processor.service';
import { FileType, DocumentStatus } from '../entities/document.entity';

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
  constructor(
    private documentService: DocumentService,
    private fileProcessorService: FileProcessorService,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { url?: string },
  ) {
    let document;

    if (body.url) {
      document = await this.documentService.create({
        name: body.url,
        type: FileType.URL,
        url: body.url,
        status: DocumentStatus.PROCESSING,
      });
    } else if (file) {
      const ext = file.originalname
        .toLowerCase()
        .substring(file.originalname.lastIndexOf('.'));
      const fileType = FILE_TYPE_MAP[ext] || FileType.TXT;

      document = await this.documentService.create({
        name: file.originalname,
        type: fileType,
        path: file.path,
        status: DocumentStatus.PROCESSING,
        fileSize: file.size,
      });
    } else {
      throw new Error('No file or URL provided');
    }

    try {
      const filePath = body.url ? body.url : file.path;
      const fileName = body.url ? body.url : file.originalname;

      const { text, metadata } = await this.fileProcessorService.processFile(
        filePath,
        fileName,
        document.type,
      );

      await this.documentService.update(document.id, {
        status: DocumentStatus.PROCESSED,
        metadata,
      });

      const chunks = this.fileProcessorService.chunkText(text);
      await this.fileProcessorService.storeChunks(document.id, chunks);

      await this.documentService.update(document.id, {
        chunkCount: chunks.length,
      });

      return {
        success: true,
        data: await this.documentService.findById(document.id),
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
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
    const skip = (page - 1) * limit;
    const [documents, total] = await this.documentService.findAll(
      name,
      skip,
      limit,
    );

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
    const document = await this.documentService.findById(id);
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
    const document = await this.documentService.findById(id);
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
