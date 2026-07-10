import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as xlsx from 'xlsx';
import sharp from 'sharp';
import { FileType } from '../../entities/document.entity';
import { AiService } from '../../ai/ai.service';
import { SpeechService } from '../speech/speech.service';
import { Neo4jService } from '../neo4j/neo4j.service';
import { RustfsService } from '../rustfs/rustfs.service';
import { LoggerService, LogServiceCall } from '../../common/logger';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { DocxLoader } from '@langchain/community/document_loaders/fs/docx';
import { PPTXLoader } from '@langchain/community/document_loaders/fs/pptx';
import { CSVLoader } from '@langchain/community/document_loaders/fs/csv';
import { HTMLWebBaseLoader } from '@langchain/community/document_loaders/web/html';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

@Injectable()
export class FileProcessorService {
  private readonly logger = new LoggerService(FileProcessorService.name);

  constructor(
    private aiService: AiService,
    private speechService: SpeechService,
    private neo4jService: Neo4jService,
    private rustfsService: RustfsService,
  ) {}

  @LogServiceCall()
  async getFileBuffer(filePath: string): Promise<Buffer> {
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      const url = new URL(filePath);
      const fullPath = decodeURIComponent(url.pathname.substring(1));
      const bucket = this.rustfsService.getBucket();
      const key = fullPath.startsWith(`${bucket}/`) ? fullPath.substring(bucket.length + 1) : fullPath;
      return this.rustfsService.downloadFile(key);
    }
    return fs.readFileSync(filePath);
  }

  private createTempFilePath(originalPath: string): string {
    const extension = path.extname(originalPath) || '.tmp';
    const tmpFile = `langchain_loader_${Date.now()}_${Math.random().toString(36).slice(2)}${extension}`;
    return path.join(os.tmpdir(), tmpFile);
  }

  private writeTempFile(buffer: Buffer, originalPath: string): string {
    const tempPath = this.createTempFilePath(originalPath);
    fs.writeFileSync(tempPath, buffer);
    return tempPath;
  }

  private async loadWithLoader<
    T extends { load: () => Promise<Array<{ pageContent: string; metadata?: Record<string, unknown> }>> },
  >(
    filePath: string,
    createLoader: (inputPath: string) => T,
  ): Promise<{ text: string; metadata: Record<string, unknown> }> {
    let tempPath = filePath;
    let needsCleanup = false;

    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      const buffer = await this.getFileBuffer(filePath);
      tempPath = this.writeTempFile(buffer, filePath);
      needsCleanup = true;
    }

    const loader = createLoader(tempPath);
    const docs = await loader.load();
    const text = docs
      .map((doc) => doc.pageContent || '')
      .join('\n\n')
      .trim();
    const metadata = docs.length > 0 ? { pageCount: docs.length, source: filePath } : { source: filePath };
    if (needsCleanup && fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch (e) {
        this.logger.warn(`无法删除临时文件 ${tempPath}: ${e}`);
      }
    }

    return { text, metadata };
  }

  private normalizeTextChunks(chunks: string[]): string[] {
    return chunks.map((chunk) => chunk.trim()).filter((chunk) => chunk.length > 0);
  }

  @LogServiceCall()
  async processFile(
    filePath: string,
    fileName: string,
    fileType: FileType,
  ): Promise<{ text: string; metadata: Record<string, unknown> }> {
    switch (fileType) {
      case FileType.PDF:
        return this.processPdf(filePath);
      case FileType.DOCX:
      case FileType.DOC:
        return this.processDocx(filePath);
      case FileType.XLSX:
      case FileType.XLS:
      case FileType.CSV:
        return this.processSpreadsheet(filePath);
      case FileType.PPTX:
      case FileType.PPT:
        return this.processPptx(filePath);
      case FileType.TXT:
        return this.processTxt(filePath);
      case FileType.MD:
        return this.processMd(filePath);
      case FileType.JSON:
        return this.processJson(filePath);
      case FileType.URL:
        return this.processUrl(fileName);
      case FileType.IMAGE:
        return this.processImage(filePath);
      case FileType.AUDIO:
        return this.processAudio(filePath);
      case FileType.VIDEO:
        return this.processVideo(filePath);
      default:
        throw new Error(`不支持的文件类型: ${fileType as string}`);
    }
  }

  @LogServiceCall()
  async processPdf(filePath: string): Promise<{ text: string; metadata: Record<string, unknown> }> {
    return this.loadWithLoader(filePath, (path) => new PDFLoader(path));
  }

  @LogServiceCall()
  async processDocx(filePath: string): Promise<{ text: string; metadata: Record<string, unknown> }> {
    return this.loadWithLoader(filePath, (path) => new DocxLoader(path));
  }

  @LogServiceCall()
  async processSpreadsheet(filePath: string): Promise<{
    text: string;
    metadata: Record<string, unknown>;
  }> {
    if (filePath.toLowerCase().endsWith('.csv')) {
      return this.loadWithLoader(filePath, (path) => new CSVLoader(path));
    }

    let tempPath = filePath;
    let needsCleanup = false;
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      const buffer = await this.getFileBuffer(filePath);
      tempPath = this.createTempFilePath(filePath);
      fs.writeFileSync(tempPath, buffer);
      needsCleanup = true;
    }

    const workbook = xlsx.readFile(tempPath);
    let text = '';

    workbook.SheetNames.forEach((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const sheetText = xlsx.utils.sheet_to_csv(sheet);
      text += `\n--- Sheet: ${sheetName} ---\n${sheetText}\n`;
    });

    if (needsCleanup && fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }

    return {
      text,
      metadata: {
        sheets: workbook.SheetNames,
        sheetCount: workbook.SheetNames.length,
      },
    };
  }

  async processPptx(filePath: string): Promise<{ text: string; metadata: Record<string, unknown> }> {
    return this.loadWithLoader(filePath, (buffer) => new PPTXLoader(buffer));
  }

  @LogServiceCall()
  async processTxt(filePath: string): Promise<{
    text: string;
    metadata: Record<string, unknown>;
  }> {
    const buffer = await this.getFileBuffer(filePath);
    return {
      text: buffer.toString('utf-8'),
      metadata: {},
    };
  }

  @LogServiceCall()
  async processMd(filePath: string): Promise<{
    text: string;
    metadata: Record<string, unknown>;
  }> {
    const buffer = await this.getFileBuffer(filePath);
    return {
      text: buffer.toString('utf-8'),
      metadata: {},
    };
  }

  @LogServiceCall()
  async processJson(filePath: string): Promise<{
    text: string;
    metadata: Record<string, unknown>;
  }> {
    const buffer = await this.getFileBuffer(filePath);
    const json = JSON.parse(buffer.toString('utf-8')) as Record<string, unknown>;
    return {
      text: JSON.stringify(json, null, 2),
      metadata: {
        keys: Object.keys(json),
      },
    };
  }

  @LogServiceCall()
  async processUrl(url: string): Promise<{ text: string; metadata: Record<string, unknown> }> {
    const loader = new HTMLWebBaseLoader(url);
    const docs = await loader.load();
    const text = docs
      .map((doc) => doc.pageContent || '')
      .join('\n\n')
      .trim();
    const metadata = docs.length > 0 ? { pageCount: docs.length, source: url } : { source: url };
    return { text, metadata };
  }

  @LogServiceCall()
  async processImage(filePath: string): Promise<{ text: string; metadata: Record<string, unknown> }> {
    let tempPath = filePath;
    let needsCleanup = false;
    let imageBuffer: Buffer;

    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      imageBuffer = await this.getFileBuffer(filePath);
      tempPath = this.createTempFilePath(filePath);
      fs.writeFileSync(tempPath, imageBuffer);
      needsCleanup = true;
    } else {
      imageBuffer = fs.readFileSync(filePath);
    }

    const image = sharp(tempPath);
    const metadata = await image.metadata();
    const imageBase64 = imageBuffer.toString('base64');

    const description = await this.aiService.getChatModel().invoke([
      {
        role: 'user',
        content: `请描述这张图片的内容：${imageBase64}`,
      },
    ]);

    if (needsCleanup && fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }

    return {
      text: typeof description.content === 'string' ? description.content : JSON.stringify(description.content || ''),
      metadata: {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
        size: imageBuffer.length,
      },
    };
  }

  @LogServiceCall()
  async processAudio(filePath: string): Promise<{ text: string; metadata: Record<string, unknown> }> {
    const audioBuffer = await this.getFileBuffer(filePath);
    const text = await this.speechService.speechToText(audioBuffer);

    return {
      text,
      metadata: {
        size: audioBuffer.length,
        format: path.extname(filePath).slice(1),
      },
    };
  }

  @LogServiceCall()
  async processVideo(filePath: string): Promise<{
    text: string;
    metadata: Record<string, unknown>;
  }> {
    const videoBuffer = await this.getFileBuffer(filePath);

    return {
      text: '视频处理需要额外的FFmpeg配置。使用占位文本。',
      metadata: {
        size: videoBuffer.length,
        format: path.extname(filePath).slice(1),
      },
    };
  }

  async splitText(text: string, chunkSize: number = 500, chunkOverlap: number = 50): Promise<string[]> {
    if (!text || text.length === 0) {
      return [];
    }

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize,
      chunkOverlap,
      separators: ['\n\n', '\n', ' ', ''],
    });

    return this.normalizeTextChunks(await splitter.splitText(text));
  }

  async chunkText(text: string, chunkSize: number = 500, chunkOverlap: number = 50): Promise<string[]> {
    return this.splitText(text, chunkSize, chunkOverlap);
  }

  @LogServiceCall()
  async storeChunks(
    documentId: string,
    chunks: string[],
    documentName: string = documentId,
  ): Promise<
    Array<{
      content: string;
      metadata: Record<string, unknown>;
      embedding: string;
      chunkIndex: number;
      totalChunks: number;
    }>
  > {
    if (!chunks || chunks.length === 0) {
      this.logger.warn(`文档 ${documentId} 没有可存储的分块`);
      return [];
    }

    const batchSize = 10;
    const totalChunks = chunks.length;
    let processedCount = 0;
    const enrichedChunks: Array<{
      content: string;
      metadata: Record<string, unknown>;
      embedding: string;
      chunkIndex: number;
      totalChunks: number;
    }> = [];

    this.logger.debug(`开始存储文档 ${documentId} 的 ${totalChunks} 个分块，每批处理 ${batchSize} 个`);

    for (let i = 0; i < chunks.length; i += batchSize) {
      const end = Math.min(i + batchSize, chunks.length);
      const batchChunks = chunks.slice(i, end);

      if (batchChunks.length === 0) {
        continue;
      }

      const batchIndices = Array.from({ length: batchChunks.length }, (_, j) => i + j);
      const embeddings = await this.aiService.generateEmbeddings(batchChunks);

      const documents = batchChunks.map((content, j) => ({
        content,
        metadata: {
          documentId,
          documentName,
          chunkIndex: batchIndices[j],
          totalChunks,
        },
      }));

      await this.neo4jService.addDocuments(documents, embeddings);

      enrichedChunks.push(
        ...batchChunks.map((content, j) => ({
          content,
          metadata: {
            documentId,
            documentName,
            chunkIndex: batchIndices[j],
            totalChunks,
          },
          embedding: JSON.stringify(embeddings[j]),
          chunkIndex: batchIndices[j],
          totalChunks,
        })),
      );

      processedCount += batchChunks.length;
      this.logger.debug(`文档 ${documentId} 分块存储进度: ${processedCount}/${totalChunks}`);
    }

    this.logger.info(`文档 ${documentId} 分块存储完成，共存储 ${processedCount} 个分块`);
    return enrichedChunks;
  }
}
