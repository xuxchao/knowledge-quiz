import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as pdfParse from 'pdf-parse';
import * as mammoth from 'mammoth';
import * as xlsx from 'xlsx';
import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import * as sharp from 'sharp';
import { FileType } from '../entities/document.entity';
import { AiService } from './ai.service';
import { SpeechService } from './speech.service';
import { Neo4jService } from './neo4j.service';

@Injectable()
export class FileProcessorService {
  constructor(
    private aiService: AiService,
    private speechService: SpeechService,
    private neo4jService: Neo4jService,
  ) {}

  async processFile(filePath: string, fileName: string, fileType: FileType): Promise<{ text: string; metadata: Record<string, unknown> }> {
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
        throw new Error(`Unsupported file type: ${fileType}`);
    }
  }

  async processPdf(filePath: string): Promise<{ text: string; metadata: Record<string, unknown> }> {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    return {
      text: data.text || '',
      metadata: {
        author: data.info.Author,
        title: data.info.Title,
        numPages: data.numpages,
      },
    };
  }

  async processDocx(filePath: string): Promise<{ text: string; metadata: Record<string, unknown> }> {
    const result = await mammoth.extractRawText({ path: filePath });
    return {
      text: result.value,
      metadata: {},
    };
  }

  async processSpreadsheet(filePath: string): Promise<{ text: string; metadata: Record<string, unknown> }> {
    const workbook = xlsx.readFile(filePath);
    let text = '';
    
    workbook.SheetNames.forEach(sheetName => {
      const sheet = workbook.Sheets[sheetName];
      const sheetText = xlsx.utils.sheet_to_csv(sheet);
      text += `\n--- Sheet: ${sheetName} ---\n${sheetText}\n`;
    });

    return {
      text,
      metadata: {
        sheets: workbook.SheetNames,
        sheetCount: workbook.SheetNames.length,
      },
    };
  }

  async processPptx(filePath: string): Promise<{ text: string; metadata: Record<string, unknown> }> {
    return {
      text: 'PPTX processing requires additional library. Using placeholder.',
      metadata: {},
    };
  }

  async processTxt(filePath: string): Promise<{ text: string; metadata: Record<string, unknown> }> {
    const text = fs.readFileSync(filePath, 'utf-8');
    return {
      text,
      metadata: {},
    };
  }

  async processMd(filePath: string): Promise<{ text: string; metadata: Record<string, unknown> }> {
    const text = fs.readFileSync(filePath, 'utf-8');
    return {
      text,
      metadata: {},
    };
  }

  async processJson(filePath: string): Promise<{ text: string; metadata: Record<string, unknown> }> {
    const content = fs.readFileSync(filePath, 'utf-8');
    const json = JSON.parse(content);
    return {
      text: JSON.stringify(json, null, 2),
      metadata: {
        keys: Object.keys(json),
      },
    };
  }

  async processUrl(url: string): Promise<{ text: string; metadata: Record<string, unknown> }> {
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

  async processImage(filePath: string): Promise<{ text: string; metadata: Record<string, unknown> }> {
    const image = sharp(filePath);
    const metadata = await image.metadata();
    
    const imageBuffer = fs.readFileSync(filePath);
    const imageBase64 = imageBuffer.toString('base64');
    
    const description = await this.aiService.getChatModel().invoke([{
      role: 'user',
      content: `请描述这张图片的内容：${imageBase64}`,
    }]);
    
    return {
      text: description.content.toString(),
      metadata: {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
        size: imageBuffer.length,
      },
    };
  }

  async processAudio(filePath: string): Promise<{ text: string; metadata: Record<string, unknown> }> {
    const audioBuffer = fs.readFileSync(filePath);
    const text = await this.speechService.speechToText(audioBuffer);
    
    return {
      text,
      metadata: {
        size: audioBuffer.length,
        format: path.extname(filePath).slice(1),
      },
    };
  }

  async processVideo(filePath: string): Promise<{ text: string; metadata: Record<string, unknown> }> {
    const videoBuffer = fs.readFileSync(filePath);
    
    return {
      text: '视频处理需要额外的FFmpeg配置。使用占位文本。',
      metadata: {
        size: videoBuffer.length,
        format: path.extname(filePath).slice(1),
      },
    };
  }

  async chunkText(text: string, chunkSize: number = 500, chunkOverlap: number = 50): Promise<string[]> {
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
    
    for (let i = 0; i < chunks.length; i++) {
      await this.neo4jService.addDocumentChunk({
        id: `${documentId}-${i}`,
        documentId,
        content: chunks[i],
        embedding: embeddings[i],
        chunkIndex: i,
        totalChunks: chunks.length,
      });
    }
  }
}
