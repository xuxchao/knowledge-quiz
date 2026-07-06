import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as mammoth from 'mammoth';
import * as xlsx from 'xlsx';
import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import sharp from 'sharp';
import { FileType } from '../../entities/document.entity';
import { AiService } from '../../ai/ai.service';
import { SpeechService } from '../speech/speech.service';
import { Neo4jService } from '../neo4j/neo4j.service';
import { RustfsService } from '../rustfs/rustfs.service';
import { PDFParse } from 'pdf-parse';
import { LoggerService, LogServiceCall } from '../../common/logger';

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
        return this.processPptx();
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
    const dataBuffer = await this.getFileBuffer(filePath);
    const pdf = new PDFParse({ data: dataBuffer });
    const textResult = await pdf.getText();
    const infoResult = await pdf.getInfo();
    await pdf.destroy();
    const info = (infoResult.info as Record<string, unknown>) || {};
    return {
      text: textResult.text || '',
      metadata: {
        author: info.Author,
        title: info.Title,
        numPages: infoResult.total,
      },
    };
  }

  @LogServiceCall()
  async processDocx(filePath: string): Promise<{ text: string; metadata: Record<string, unknown> }> {
    let tempPath = filePath;
    let needsCleanup = false;

    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      const buffer = await this.getFileBuffer(filePath);
      tempPath = path.join('/tmp', `docx_${Date.now()}.docx`);
      fs.writeFileSync(tempPath, buffer);
      needsCleanup = true;
    }

    const result = await mammoth.extractRawText({ path: tempPath });

    if (needsCleanup) {
      fs.unlinkSync(tempPath);
    }

    return {
      text: result.value,
      metadata: {},
    };
  }

  @LogServiceCall()
  async processSpreadsheet(filePath: string): Promise<{
    text: string;
    metadata: Record<string, unknown>;
  }> {
    let tempPath = filePath;
    let needsCleanup = false;

    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      const buffer = await this.getFileBuffer(filePath);
      tempPath = path.join('/tmp', `spreadsheet_${Date.now()}${path.extname(filePath)}`);
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

    if (needsCleanup) {
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

  processPptx(): {
    text: string;
    metadata: Record<string, unknown>;
  } {
    return {
      text: 'PPTX处理需要额外的库支持。使用占位文本。',
      metadata: {},
    };
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
    const response = await fetch(url);
    const html = await response.text();
    const $ = cheerio.load(html);

    $('script, style, nav, header, footer').remove();
    const text = $.text().replace(/\s+/g, ' ').trim();

    return {
      text,
      metadata: {
        url: '***URL***',
        title: $('title').text(),
      },
    };
  }

  @LogServiceCall()
  async processImage(filePath: string): Promise<{ text: string; metadata: Record<string, unknown> }> {
    let tempPath = filePath;
    let needsCleanup = false;
    let imageBuffer: Buffer;

    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      imageBuffer = await this.getFileBuffer(filePath);
      tempPath = path.join('/tmp', `image_${Date.now()}${path.extname(filePath)}`);
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

    if (needsCleanup) {
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

  chunkText(text: string, chunkSize: number = 500, chunkOverlap: number = 50): string[] {
    if (!text || text.length === 0) {
      return [];
    }

    const chunks: string[] = [];
    let start = 0;
    const safeChunkSize = Math.max(1, chunkSize);
    const safeOverlap = Math.max(0, Math.min(chunkOverlap, Math.floor(safeChunkSize / 2)));

    while (start < text.length) {
      const end = Math.min(start + safeChunkSize, text.length);
      let chunk = text.substring(start, end);

      if (end < text.length) {
        const lastPeriod = chunk.lastIndexOf('.');
        const lastNewline = chunk.lastIndexOf('\n');
        const splitPoint = Math.max(lastPeriod, lastNewline);

        if (splitPoint > start + safeOverlap) {
          chunk = text.substring(start, splitPoint + 1);
        }
      }

      const trimmedChunk = chunk.trim();
      if (trimmedChunk.length > 0) {
        chunks.push(trimmedChunk);
      }

      const nextStart = end - safeOverlap;
      if (nextStart <= start) {
        start = end;
      } else {
        start = nextStart;
      }
    }

    return chunks;
  }

  @LogServiceCall()
  async storeChunks(documentId: string, chunks: string[]): Promise<void> {
    if (!chunks || chunks.length === 0) {
      this.logger.warn(`文档 ${documentId} 没有可存储的分块`);
      return;
    }

    const batchSize = 10;
    const totalChunks = chunks.length;
    let processedCount = 0;

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
          chunkIndex: batchIndices[j],
          totalChunks,
        },
      }));

      await this.neo4jService.addDocuments(documents, embeddings);

      processedCount += batchChunks.length;
      this.logger.debug(`文档 ${documentId} 分块存储进度: ${processedCount}/${totalChunks}`);
    }

    this.logger.info(`文档 ${documentId} 分块存储完成，共存储 ${processedCount} 个分块`);
  }
}
