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

@Injectable()
export class FileProcessorService {
  constructor(
    private aiService: AiService,
    private speechService: SpeechService,
    private neo4jService: Neo4jService,
    private rustfsService: RustfsService,
  ) {}

  async getFileBuffer(filePath: string): Promise<Buffer> {
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      const url = new URL(filePath);
      const fullPath = decodeURIComponent(url.pathname.substring(1));
      const bucket = this.rustfsService.getBucket();
      const key = fullPath.startsWith(`${bucket}/`)
        ? fullPath.substring(bucket.length + 1)
        : fullPath;
      return this.rustfsService.downloadFile(key);
    }
    return fs.readFileSync(filePath);
  }

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
        throw new Error(`Unsupported file type: ${fileType as string}`);
    }
  }

  async processPdf(
    filePath: string,
  ): Promise<{ text: string; metadata: Record<string, unknown> }> {
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

  async processDocx(
    filePath: string,
  ): Promise<{ text: string; metadata: Record<string, unknown> }> {
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

  async processSpreadsheet(filePath: string): Promise<{
    text: string;
    metadata: Record<string, unknown>;
  }> {
    let tempPath = filePath;
    let needsCleanup = false;

    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      const buffer = await this.getFileBuffer(filePath);
      tempPath = path.join(
        '/tmp',
        `spreadsheet_${Date.now()}${path.extname(filePath)}`,
      );
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
      text: 'PPTX processing requires additional library. Using placeholder.',
      metadata: {},
    };
  }

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

  async processJson(filePath: string): Promise<{
    text: string;
    metadata: Record<string, unknown>;
  }> {
    const buffer = await this.getFileBuffer(filePath);
    const json = JSON.parse(buffer.toString('utf-8')) as Record<
      string,
      unknown
    >;
    return {
      text: JSON.stringify(json, null, 2),
      metadata: {
        keys: Object.keys(json),
      },
    };
  }

  async processUrl(
    url: string,
  ): Promise<{ text: string; metadata: Record<string, unknown> }> {
    const response = await fetch(url);
    const html = await response.text();
    const $ = cheerio.load(html);

    $('script, style, nav, header, footer').remove();
    const text = $.text().replace(/\s+/g, ' ').trim();

    return {
      text,
      metadata: {
        url,
        title: $('title').text(),
      },
    };
  }

  async processImage(
    filePath: string,
  ): Promise<{ text: string; metadata: Record<string, unknown> }> {
    let tempPath = filePath;
    let needsCleanup = false;
    let imageBuffer: Buffer;

    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      imageBuffer = await this.getFileBuffer(filePath);
      tempPath = path.join(
        '/tmp',
        `image_${Date.now()}${path.extname(filePath)}`,
      );
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
      text:
        typeof description.content === 'string'
          ? description.content
          : JSON.stringify(description.content || ''),
      metadata: {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
        size: imageBuffer.length,
      },
    };
  }

  async processAudio(
    filePath: string,
  ): Promise<{ text: string; metadata: Record<string, unknown> }> {
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

  chunkText(
    text: string,
    chunkSize: number = 500,
    chunkOverlap: number = 50,
  ): string[] {
    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      const end = Math.min(start + chunkSize, text.length);
      let chunk = text.substring(start, end);

      if (end < text.length) {
        const lastPeriod = chunk.lastIndexOf('.');
        const lastNewline = chunk.lastIndexOf('\n');
        const splitPoint = Math.max(lastPeriod, lastNewline);

        if (splitPoint > start + chunkOverlap) {
          chunk = text.substring(start, splitPoint + 1);
        }
      }

      chunks.push(chunk.trim());
      start = end - chunkOverlap;
    }

    return chunks;
  }

  async storeChunks(documentId: string, chunks: string[]): Promise<void> {
    const embeddings = await this.aiService.generateEmbeddings(chunks);

    const documents = chunks.map((content, i) => ({
      content,
      metadata: {
        documentId,
        chunkIndex: i,
        totalChunks: chunks.length,
      },
    }));

    await this.neo4jService.addDocuments(documents, embeddings);
  }
}
