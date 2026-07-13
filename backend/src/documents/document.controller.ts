import {
  Body,
  Controller,
  Delete,
  Get,
  BadRequestException,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { DocumentService } from './document.service';
import { RustfsService } from '../infrastructure/rustfs/rustfs.service';
import { Document, FileType, DocumentStatus } from '../entities/document.entity';
import { LoggerService } from '../common/logger';
import { DocumentQueryDto } from './DTO/document-query.dto';
import { UploadDocumentDto } from './DTO/upload-document.dto';
import { DocumentIngestionService } from './document-ingestion.service';
import { createHash } from 'node:crypto';

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
    private rustfsService: RustfsService,
    private documentIngestionService: DocumentIngestionService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024, files: 1 } }))
  async uploadFile(@UploadedFile() file: Express.Multer.File, @Body() body: UploadDocumentDto) {
    let originalName = file?.originalname || '';
    try {
      originalName = this.decodeOriginalFileName(originalName);
    } catch (e) {
      // ignore and fall back to originalName
      this.logger.warn(
        `文件名解码失败 - 原始文件名: ${file?.originalname || ''}, 错误: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    this.logger.debug(`请求进入 - 上传文件，文件名: ${originalName || '无'}, URL: ${body.url ? '***URL***' : '无'}`);

    let document: Document;
    let rustfsUrl: string | undefined;
    let normalizedFileName = '';
    let fileType = FileType.TXT;

    if (body.url) {
      document = await this.documentService.create({
        name: body.url,
        type: FileType.URL,
        url: body.url,
        status: DocumentStatus.PROCESSING,
      });
    } else if (file) {
      // Some browsers / multipart parsers provide the filename using latin1 encoding,
      // which results in garbled non-ASCII names (e.g. Chinese). Try re-decoding
      // from latin1 -> utf8 and use the decoded value when it looks valid.

      const ext = originalName.toLowerCase().substring(originalName.lastIndexOf('.'));
      const detectedType = FILE_TYPE_MAP[ext];
      if (!detectedType) throw new BadRequestException(`Unsupported file extension: ${ext || 'none'}`);
      fileType = detectedType;
      this.validateFileSignature(file.buffer, fileType, ext);
      normalizedFileName = originalName.normalize('NFC');

      document = await this.documentService.create({
        name: normalizedFileName,
        type: fileType,
        path: '',
        status: DocumentStatus.PROCESSING,
        fileSize: file.size,
      });
      this.logger.info(
        `文档创建成功 - 文档ID: ${document.id}, 文件名: ${normalizedFileName}, 文件类型: ${fileType}, 文件大小: ${file.size}字节`,
      );

      const rustfsKey = `${document.id}/${normalizedFileName}`;
      rustfsUrl = await this.rustfsService.uploadFile(rustfsKey, file.buffer, file.mimetype);

      await this.documentService.update(document.id, {
        path: rustfsUrl,
        storageKey: rustfsKey,
      });
    } else {
      throw new BadRequestException('No file or URL provided');
    }

    const filePath = body.url ? body.url : rustfsUrl || file.path;
    const fileName = body.url ? body.url : normalizedFileName;
    const contentHash = file
      ? createHash('sha256').update(file.buffer).digest('hex')
      : createHash('sha256')
          .update(body.url || '')
          .digest('hex');
    let jobId: string;
    try {
      jobId = await this.documentIngestionService.enqueue(document.id, filePath, fileName, contentHash);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `文档入队失败 - 文档ID: ${document.id}，错误: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );
      await this.documentService.delete(document.id);
      throw error;
    }
    this.logger.info(`请求成功 - 文档已进入后台处理队列，文档ID: ${document.id}, 任务ID: ${jobId}`);
    return { success: true, data: { documentId: document.id, jobId, status: document.status } };
  }

  @Get()
  async listDocuments(@Query() query: DocumentQueryDto) {
    const { name, page, limit } = query;
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
  async getDocument(@Param('id', new ParseUUIDPipe()) id: string) {
    this.logger.debug(`请求进入 - 获取文档，ID: ${id}`);

    const document = await this.documentService.findByIdWithChunks(id);
    if (!document) {
      this.logger.warn(`文档未找到 - ID: ${id}`);
      throw new NotFoundException('Document not found');
    }

    this.logger.info(`请求成功 - 获取文档完成，ID: ${id}`);

    return {
      success: true,
      data: document,
    };
  }

  @Get(':id/ingestion')
  async getIngestionStatus(@Param('id', new ParseUUIDPipe()) id: string) {
    this.logger.debug(`请求进入 - 获取文档摄取状态，ID: ${id}`);
    const status = await this.documentIngestionService.getStatus(id);
    if (!status) throw new NotFoundException('Document not found');
    this.logger.info(`请求成功 - 获取文档摄取状态完成，ID: ${id}`);
    return { success: true, data: status };
  }

  @Get(':id/download')
  async downloadDocument(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    this.logger.debug(`请求进入 - 下载文档，ID: ${id}`);
    try {
      const document = await this.documentService.findById(id, false);
      if (!document?.storageKey) {
        this.logger.warn(`可下载文档未找到 - ID: ${id}`);
        throw new NotFoundException('Document file not found');
      }

      const file = await this.rustfsService.downloadFile(document.storageKey);
      response.set({
        'Content-Type': 'application/octet-stream',
        'Content-Length': file.length.toString(),
        'Content-Disposition': `attachment; filename="document"; filename*=UTF-8''${this.encodeHeaderValue(document.name)}`,
      });

      this.logger.info(`请求成功 - 下载文档完成，ID: ${id}, 文件名: ${document.name}`);
      return new StreamableFile(file);
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      const stackTrace = error instanceof Error ? error.stack : undefined;
      this.logger.error(`请求处理异常 - 下载文档失败，ID: ${id}，错误: ${errorMessage}`, stackTrace);
      throw error;
    }
  }

  @Delete(':id')
  async deleteDocument(@Param('id', new ParseUUIDPipe()) id: string) {
    this.logger.debug(`请求进入 - 删除文档，ID: ${id}`);

    const document = await this.documentService.findById(id, false);
    if (!document) {
      this.logger.warn(`文档未找到 - ID: ${id}`);
      throw new NotFoundException('Document not found');
    }

    await this.documentService.delete(id);

    this.logger.info(`请求成功 - 删除文档完成，ID: ${id}`);

    return {
      success: true,
      message: 'Document deleted successfully',
    };
  }

  private decodeOriginalFileName(originalName: string): string {
    if (!/[\u0080-\u00ff]/.test(originalName)) {
      return originalName;
    }

    const decoded = Buffer.from(originalName, 'latin1').toString('utf8');
    if (decoded.includes('\uFFFD')) {
      return originalName;
    }

    return decoded;
  }

  private encodeHeaderValue(value: string): string {
    return encodeURIComponent(value).replace(
      /[!'()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  }

  private validateFileSignature(buffer: Buffer, fileType: FileType, extension: string): void {
    const startsWith = (...bytes: number[]) => bytes.every((value, index) => buffer[index] === value);
    const ascii = buffer.subarray(0, 12).toString('ascii');
    const valid = (() => {
      if (fileType === FileType.PDF) return ascii.startsWith('%PDF-');
      if ([FileType.DOCX, FileType.XLSX, FileType.PPTX].includes(fileType)) return startsWith(0x50, 0x4b);
      if ([FileType.DOC, FileType.XLS, FileType.PPT].includes(fileType)) return startsWith(0xd0, 0xcf, 0x11, 0xe0);
      if (fileType === FileType.IMAGE) {
        return (
          startsWith(0xff, 0xd8) ||
          startsWith(0x89, 0x50, 0x4e, 0x47) ||
          ascii.startsWith('GIF8') ||
          ascii.startsWith('RIFF')
        );
      }
      if (fileType === FileType.AUDIO) {
        return ascii.startsWith('ID3') || ascii.startsWith('RIFF') || ascii.includes('ftyp') || startsWith(0xff, 0xfb);
      }
      if (fileType === FileType.VIDEO) return ascii.includes('ftyp');
      return !buffer.subarray(0, Math.min(buffer.length, 4096)).includes(0);
    })();
    if (!valid) throw new BadRequestException(`File content does not match extension ${extension}`);
  }
}
