import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as net from 'node:net';
import { lookup } from 'node:dns/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as xlsx from 'xlsx';
import sharp from 'sharp';
import * as cheerio from 'cheerio';
import { FileType } from '../../entities/document.entity';
import { AiService } from '../../ai/ai.service';
import { SpeechService } from '../speech/speech.service';
import { RustfsService } from '../rustfs/rustfs.service';
import { LoggerService, LogServiceCall } from '../../common/logger';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { DocxLoader } from '@langchain/community/document_loaders/fs/docx';
import { PPTXLoader } from '@langchain/community/document_loaders/fs/pptx';
import { CSVLoader } from '@langchain/community/document_loaders/fs/csv';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { getEncoding } from 'js-tiktoken';
import { PDFParse } from 'pdf-parse';

export interface ParsedSection {
  text: string;
  type: 'page' | 'paragraph' | 'heading' | 'table-row' | 'slide' | 'json-record' | 'transcript' | 'image';
  metadata: {
    pageNumber?: number;
    sheetName?: string;
    rowRange?: string;
    slideNumber?: number;
    headingPath?: string[];
    startMs?: number;
    endMs?: number;
    [key: string]: unknown;
  };
}

export interface ParsedDocument {
  text: string;
  metadata: Record<string, unknown>;
  sections: ParsedSection[];
}

export interface StructuredChunk extends ParsedSection {
  tokenCount: number;
}

@Injectable()
export class FileProcessorService {
  private readonly logger = new LoggerService(FileProcessorService.name);
  private readonly execFileAsync = promisify(execFile);
  private readonly tokenizer = getEncoding('cl100k_base');

  constructor(
    private aiService: AiService,
    private speechService: SpeechService,
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
    return fs.promises.readFile(filePath);
  }

  private createTempFilePath(originalPath: string): string {
    const extension = path.extname(originalPath) || '.tmp';
    const tmpFile = `langchain_loader_${Date.now()}_${Math.random().toString(36).slice(2)}${extension}`;
    return path.join(os.tmpdir(), tmpFile);
  }

  private async writeTempFile(buffer: Buffer, originalPath: string): Promise<string> {
    const tempPath = this.createTempFilePath(originalPath);
    await fs.promises.writeFile(tempPath, buffer);
    return tempPath;
  }

  private async loadWithLoader<
    T extends { load: () => Promise<Array<{ pageContent: string; metadata?: Record<string, unknown> }>> },
  >(filePath: string, createLoader: (inputPath: string) => T): Promise<ParsedDocument> {
    let tempPath = filePath;
    let needsCleanup = false;

    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      const buffer = await this.getFileBuffer(filePath);
      tempPath = await this.writeTempFile(buffer, filePath);
      needsCleanup = true;
    }

    const loader = createLoader(tempPath);
    const docs = await loader.load();
    const text = docs
      .map((doc) => doc.pageContent || '')
      .join('\n\n')
      .trim();
    const sections = docs.flatMap((doc, index) => {
      const value = (doc.pageContent || '').trim();
      return value
        ? [{ text: value, type: 'page' as const, metadata: { ...(doc.metadata || {}), pageNumber: index + 1 } }]
        : [];
    });
    const metadata = docs.length > 0 ? { pageCount: docs.length, source: filePath } : { source: filePath };
    if (needsCleanup) {
      try {
        await fs.promises.rm(tempPath, { force: true });
      } catch (e) {
        this.logger.warn(`无法删除临时文件 ${tempPath}: ${e}`);
      }
    }

    return { text, metadata, sections };
  }

  private normalizeTextChunks(chunks: string[]): string[] {
    return chunks.map((chunk) => chunk.trim()).filter((chunk) => chunk.length > 0);
  }

  @LogServiceCall()
  async processFile(filePath: string, fileName: string, fileType: FileType): Promise<ParsedDocument> {
    const legacyTarget =
      fileType === FileType.DOC
        ? 'docx'
        : fileType === FileType.PPT
          ? 'pptx'
          : fileType === FileType.XLS
            ? 'xlsx'
            : undefined;
    const converted = legacyTarget ? await this.convertLegacyOffice(filePath, fileName, legacyTarget) : undefined;
    const effectivePath = converted?.filePath ?? filePath;
    let result: { text: string; metadata: Record<string, unknown>; sections?: ParsedSection[] };
    try {
      switch (fileType) {
        case FileType.PDF:
          result = await this.processPdf(effectivePath);
          break;
        case FileType.DOCX:
        case FileType.DOC:
          result = await this.processDocx(effectivePath);
          break;
        case FileType.XLSX:
        case FileType.XLS:
        case FileType.CSV:
          result = await this.processSpreadsheet(effectivePath);
          break;
        case FileType.PPTX:
        case FileType.PPT:
          result = await this.processPptx(effectivePath);
          break;
        case FileType.TXT:
          result = await this.processTxt(filePath);
          break;
        case FileType.MD:
          result = await this.processMd(filePath);
          break;
        case FileType.JSON:
          result = await this.processJson(filePath);
          break;
        case FileType.URL:
          result = await this.processUrl(fileName);
          break;
        case FileType.IMAGE:
          result = await this.processImage(filePath);
          break;
        case FileType.AUDIO:
          result = await this.processAudio(filePath);
          break;
        case FileType.VIDEO:
          result = await this.processVideo(filePath);
          break;
        default:
          throw new Error(`不支持的文件类型: ${fileType as string}`);
      }
      const sections =
        result.sections ?? (result.text.trim() ? [{ text: result.text.trim(), type: 'paragraph', metadata: {} }] : []);
      return { ...result, sections };
    } finally {
      if (converted) await fs.promises.rm(converted.directory, { recursive: true, force: true });
    }
  }

  @LogServiceCall()
  async processPdf(filePath: string): Promise<ParsedDocument> {
    const parsed = await this.loadWithLoader(filePath, (path) => new PDFLoader(path));
    if (parsed.text.replace(/\s+/g, '').length >= 20) return parsed;
    return this.ocrPdf(filePath);
  }

  @LogServiceCall()
  async processDocx(filePath: string): Promise<{ text: string; metadata: Record<string, unknown> }> {
    return this.loadWithLoader(filePath, (path) => new DocxLoader(path));
  }

  @LogServiceCall()
  async processSpreadsheet(filePath: string): Promise<{
    text: string;
    metadata: Record<string, unknown>;
    sections?: ParsedSection[];
  }> {
    if (filePath.toLowerCase().endsWith('.csv')) {
      return this.loadWithLoader(filePath, (path) => new CSVLoader(path));
    }

    const workbook = xlsx.read(await this.getFileBuffer(filePath), { type: 'buffer' });
    let text = '';
    const sections: ParsedSection[] = [];

    workbook.SheetNames.forEach((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const sheetText = xlsx.utils.sheet_to_csv(sheet);
      text += `\n--- Sheet: ${sheetName} ---\n${sheetText}\n`;
      const rows = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false });
      rows.forEach((row, index) => {
        const rowText = row
          .map((cell) => {
            if (cell == null) return '';
            return (cell as { toString(): string }).toString();
          })
          .join(' | ')
          .trim();
        if (rowText)
          sections.push({
            text: rowText,
            type: 'table-row',
            metadata: { sheetName, rowRange: `${index + 1}:${index + 1}` },
          });
      });
    });

    return {
      text,
      metadata: {
        sheets: workbook.SheetNames,
        sheetCount: workbook.SheetNames.length,
      },
      sections,
    };
  }

  @LogServiceCall()
  async processPptx(filePath: string): Promise<ParsedDocument> {
    const result = await this.loadWithLoader(filePath, (buffer) => new PPTXLoader(buffer));
    return {
      ...result,
      sections: (result.sections ?? [{ text: result.text, type: 'slide' as const, metadata: {} }]).map(
        (section, index) => ({
          ...section,
          type: 'slide',
          metadata: { ...section.metadata, pageNumber: undefined, slideNumber: index + 1 },
        }),
      ),
    };
  }

  @LogServiceCall()
  async processTxt(filePath: string): Promise<{
    text: string;
    metadata: Record<string, unknown>;
  }> {
    const buffer = await this.getFileBuffer(filePath);
    return {
      text: this.decodeText(buffer).text,
      metadata: { encoding: this.decodeText(buffer).encoding },
    };
  }

  @LogServiceCall()
  async processMd(filePath: string): Promise<{
    text: string;
    metadata: Record<string, unknown>;
    sections?: ParsedSection[];
  }> {
    const buffer = await this.getFileBuffer(filePath);
    const decoded = this.decodeText(buffer);
    const headings: string[] = [];
    const sections: ParsedSection[] = [];
    let current: string[] = [];
    const flush = () => {
      const text = current.join('\n').trim();
      if (text) sections.push({ text, type: 'paragraph', metadata: { headingPath: [...headings] } });
      current = [];
    };
    for (const line of decoded.text.split(/\r?\n/)) {
      const match = /^(#{1,6})\s+(.+)$/.exec(line);
      if (!match) {
        current.push(line);
        continue;
      }
      flush();
      const level = match[1].length;
      headings.splice(level - 1);
      headings[level - 1] = match[2].trim();
    }
    flush();
    return {
      text: decoded.text,
      metadata: { encoding: decoded.encoding },
      sections,
    };
  }

  @LogServiceCall()
  async processJson(filePath: string): Promise<{
    text: string;
    metadata: Record<string, unknown>;
    sections?: ParsedSection[];
  }> {
    const buffer = await this.getFileBuffer(filePath);
    const json = JSON.parse(buffer.toString('utf-8')) as Record<string, unknown> | unknown[];
    const records = Array.isArray(json) ? json : Object.entries(json).map(([key, value]) => ({ key, value }));
    return {
      text: JSON.stringify(json, null, 2),
      metadata: {
        keys: Object.keys(json),
      },
      sections: records.map((record, index) => ({
        text: JSON.stringify(record, null, 2),
        type: 'json-record',
        metadata: { jsonPath: Array.isArray(json) ? `$[${index}]` : `$.${String((record as { key: string }).key)}` },
      })),
    };
  }

  @LogServiceCall()
  async processUrl(url: string): Promise<{ text: string; metadata: Record<string, unknown> }> {
    const { html, finalUrl } = await this.fetchSafeHtml(url);
    const $ = cheerio.load(html);
    $('script, style, noscript, nav, footer, iframe').remove();
    const title = $('title').first().text().replace(/\s+/g, ' ').trim();
    const canonical = $('link[rel="canonical"]').attr('href');
    const text = ($('main, article').first().text() || $('body').text()).replace(/\s+/g, ' ').trim();
    return { text, metadata: { source: finalUrl, title, canonicalUrl: canonical || finalUrl } };
  }

  @LogServiceCall()
  async processImage(filePath: string): Promise<{ text: string; metadata: Record<string, unknown> }> {
    const imageBuffer = await this.getFileBuffer(filePath);
    const image = sharp(imageBuffer);
    const metadata = await image.metadata();
    const imageFormat = String(metadata.format || 'png');
    const mimeType = `image/${imageFormat === 'jpg' ? 'jpeg' : imageFormat}`;
    const description = await this.aiService.describeImage(`data:${mimeType};base64,${imageBuffer.toString('base64')}`);

    return {
      text: description,
      metadata: {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
        size: imageBuffer.length,
      },
    };
  }

  @LogServiceCall()
  async processAudio(
    filePath: string,
  ): Promise<{ text: string; metadata: Record<string, unknown>; sections?: ParsedSection[] }> {
    const audioBuffer = await this.getFileBuffer(filePath);
    const format = path.extname(new URL(filePath, 'file:///').pathname).slice(1).toLowerCase() || 'wav';
    const segments = await this.speechService.batchSpeechToText(audioBuffer, format);
    const text = segments.map((segment) => segment.result).join('\n');

    return {
      text,
      metadata: {
        size: audioBuffer.length,
        format,
        segments,
      },
      sections: segments.map((segment) => ({
        text: segment.result,
        type: 'transcript',
        metadata: { startMs: segment.startMs, endMs: segment.endMs },
      })),
    };
  }

  @LogServiceCall()
  async processVideo(filePath: string): Promise<{
    text: string;
    metadata: Record<string, unknown>;
  }> {
    const videoBuffer = await this.getFileBuffer(filePath);
    const taskDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rag-video-'));
    const inputPath = path.join(taskDir, `input${path.extname(new URL(filePath, 'file:///').pathname) || '.mp4'}`);
    const audioPath = path.join(taskDir, 'audio.wav');
    const framePattern = path.join(taskDir, 'frame-%03d.jpg');
    const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
    try {
      await fs.promises.writeFile(inputPath, videoBuffer);
      await this.execFileAsync(ffmpegPath, ['-y', '-i', inputPath, '-vn', '-ac', '1', '-ar', '16000', audioPath]);
      const transcript = await this.speechService.speechToText(await fs.promises.readFile(audioPath), 'wav');
      await this.execFileAsync(ffmpegPath, ['-y', '-i', inputPath, '-vf', 'fps=1/30', '-frames:v', '20', framePattern]);
      const frameFiles = (await fs.promises.readdir(taskDir)).filter((name) => /^frame-\d+\.jpg$/.test(name)).sort();
      const descriptions: string[] = [];
      for (const frame of frameFiles) {
        const data = await fs.promises.readFile(path.join(taskDir, frame));
        descriptions.push(await this.aiService.describeImage(`data:image/jpeg;base64,${data.toString('base64')}`));
      }
      const text = [transcript, ...descriptions].filter(Boolean).join('\n\n');
      return {
        text,
        metadata: { size: videoBuffer.length, format: path.extname(inputPath).slice(1), frameCount: frameFiles.length },
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`视频处理失败 - 错误: ${message}`, error instanceof Error ? error.stack : undefined);
      throw new Error(`视频处理失败，请检查FFmpeg和云服务配置: ${message}`);
    } finally {
      await fs.promises.rm(taskDir, { recursive: true, force: true });
    }
  }

  @LogServiceCall()
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

  @LogServiceCall()
  splitSections(sections: ParsedSection[], chunkSize = 400, chunkOverlap = 60): Promise<StructuredChunk[]> {
    const output: StructuredChunk[] = [];
    for (const section of sections) {
      const tokens = this.tokenizer.encode(section.text);
      if (tokens.length <= chunkSize) {
        output.push({ ...section, tokenCount: tokens.length });
        continue;
      }
      const step = chunkSize - chunkOverlap;
      for (let offset = 0; offset < tokens.length; offset += step) {
        const text = this.tokenizer.decode(tokens.slice(offset, offset + chunkSize)).trim();
        if (text) output.push({ ...section, text, tokenCount: this.estimateTokenCount(text) });
        if (offset + chunkSize >= tokens.length) break;
      }
    }
    return Promise.resolve(output);
  }

  @LogServiceCall()
  async chunkText(text: string, chunkSize: number = 500, chunkOverlap: number = 50): Promise<string[]> {
    return this.splitText(text, chunkSize, chunkOverlap);
  }

  @LogServiceCall()
  async storeChunks(
    documentId: string,
    chunks: Array<string | StructuredChunk>,
    documentName: string = documentId,
  ): Promise<
    Array<{
      content: string;
      metadata: Record<string, unknown>;
      embedding: string;
      chunkIndex: number;
      totalChunks: number;
      tokenCount?: number;
      pageNumber?: number;
      sheetName?: string;
      rowRange?: string;
      slideNumber?: number;
      headingPath?: string[];
      startMs?: number;
      endMs?: number;
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
      const batchTexts = batchChunks.map((chunk) => (typeof chunk === 'string' ? chunk : chunk.text));

      if (batchChunks.length === 0) {
        continue;
      }

      const batchIndices = Array.from({ length: batchChunks.length }, (_, j) => i + j);
      const embeddings = await this.aiService.generateEmbeddings(batchTexts);
      const expectedDimensions = process.env.EMBEDDING_DIMENSIONS
        ? Number(process.env.EMBEDDING_DIMENSIONS)
        : undefined;
      if (expectedDimensions && embeddings.some((embedding) => embedding.length !== expectedDimensions)) {
        throw new Error(`Embedding维度不匹配，期望${expectedDimensions}维`);
      }

      enrichedChunks.push(
        ...batchChunks.map((chunk, j) => {
          const content = typeof chunk === 'string' ? chunk : chunk.text;
          const sectionMetadata = typeof chunk === 'string' ? {} : chunk.metadata;
          return {
            content,
            metadata: {
              ...sectionMetadata,
              documentId,
              documentName,
              chunkIndex: batchIndices[j],
              totalChunks,
            },
            embedding: JSON.stringify(embeddings[j]),
            chunkIndex: batchIndices[j],
            totalChunks,
            tokenCount: typeof chunk === 'string' ? this.estimateTokenCount(content) : chunk.tokenCount,
            pageNumber: typeof chunk === 'string' ? undefined : chunk.metadata.pageNumber,
            sheetName: typeof chunk === 'string' ? undefined : chunk.metadata.sheetName,
            rowRange: typeof chunk === 'string' ? undefined : chunk.metadata.rowRange,
            slideNumber: typeof chunk === 'string' ? undefined : chunk.metadata.slideNumber,
            headingPath: typeof chunk === 'string' ? undefined : chunk.metadata.headingPath,
            startMs: typeof chunk === 'string' ? undefined : chunk.metadata.startMs,
            endMs: typeof chunk === 'string' ? undefined : chunk.metadata.endMs,
          };
        }),
      );

      processedCount += batchChunks.length;
      this.logger.debug(`文档 ${documentId} 分块存储进度: ${processedCount}/${totalChunks}`);
    }

    this.logger.info(`文档 ${documentId} 分块存储完成，共存储 ${processedCount} 个分块`);
    return enrichedChunks;
  }

  private estimateTokenCount(text: string): number {
    return Math.max(1, this.tokenizer.encode(text).length);
  }

  private async fetchSafeHtml(inputUrl: string): Promise<{ html: string; finalUrl: string }> {
    let current = new URL(inputUrl);
    const maxBytes = Number(process.env.URL_MAX_BYTES || 5 * 1024 * 1024);
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      await this.assertPublicHost(current);
      const response = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new Error('网页重定向缺少Location');
        current = new URL(location, current);
        continue;
      }
      if (!response.ok) throw new Error(`网页请求失败: HTTP ${response.status}`);
      if (!(response.headers.get('content-type') || '').toLowerCase().includes('text/html'))
        throw new Error('URL内容不是HTML');
      const declaredLength = Number(response.headers.get('content-length') || 0);
      if (declaredLength > maxBytes) throw new Error('网页响应超过大小限制');
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > maxBytes) throw new Error('网页响应超过大小限制');
      return { html: buffer.toString('utf8'), finalUrl: current.toString() };
    }
    throw new Error('网页重定向次数过多');
  }

  private async assertPublicHost(url: URL): Promise<void> {
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅支持HTTP或HTTPS URL');
    const addresses = net.isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true });
    if (addresses.some(({ address }) => this.isPrivateAddress(address))) throw new Error('禁止访问内网或保留地址');
  }

  private isPrivateAddress(address: string): boolean {
    const normalized = address.toLowerCase();
    return (
      normalized === '::1' ||
      normalized.startsWith('fe80:') ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      /^127\./.test(normalized) ||
      /^10\./.test(normalized) ||
      /^169\.254\./.test(normalized) ||
      /^192\.168\./.test(normalized) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(normalized) ||
      normalized === '0.0.0.0'
    );
  }

  private decodeText(buffer: Buffer): { text: string; encoding: string } {
    if (buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])))
      return { text: buffer.subarray(3).toString('utf8'), encoding: 'utf-8' };
    if (buffer.subarray(0, 2).equals(Buffer.from([0xff, 0xfe])))
      return { text: buffer.subarray(2).toString('utf16le'), encoding: 'utf-16le' };
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), encoding: 'utf-8' };
    } catch {
      try {
        return { text: new TextDecoder('gb18030', { fatal: true }).decode(buffer), encoding: 'gb18030' };
      } catch {
        throw new Error('无法识别文本文件编码');
      }
    }
  }

  private async convertLegacyOffice(
    filePath: string,
    fileName: string,
    targetExtension: 'docx' | 'pptx' | 'xlsx',
  ): Promise<{ filePath: string; directory: string }> {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rag-office-'));
    const sourcePath = path.join(directory, path.basename(fileName));
    try {
      await fs.promises.writeFile(sourcePath, await this.getFileBuffer(filePath));
      await this.execFileAsync(process.env.LIBREOFFICE_PATH || 'soffice', [
        '--headless',
        '--convert-to',
        targetExtension,
        '--outdir',
        directory,
        sourcePath,
      ]);
      const outputPath = path.join(directory, `${path.parse(sourcePath).name}.${targetExtension}`);
      await fs.promises.access(outputPath);
      return { filePath: outputPath, directory };
    } catch (error: unknown) {
      await fs.promises.rm(directory, { recursive: true, force: true });
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`旧版Office文件转换失败，请检查LibreOffice配置: ${message}`);
    }
  }

  private async ocrPdf(filePath: string): Promise<ParsedDocument> {
    const parser = new PDFParse({ data: await this.getFileBuffer(filePath) });
    try {
      const extracted = await parser.getText();
      const textSections = extracted.pages.flatMap((page) => {
        const text = page.text.trim();
        return text ? [{ text, type: 'page' as const, metadata: { pageNumber: page.num, parser: 'pdf-parse' } }] : [];
      });
      if (textSections.some((section) => section.text.replace(/\s+/g, '').length >= 20)) {
        return {
          text: textSections.map((section) => section.text).join('\n\n'),
          metadata: { pageCount: extracted.total, source: filePath, parser: 'pdf-parse' },
          sections: textSections,
        };
      }

      const screenshots = await parser.getScreenshot({ desiredWidth: 1600, imageDataUrl: true, imageBuffer: false });
      const sections: ParsedSection[] = [];
      for (const page of screenshots.pages) {
        const text = await this.aiService.describeImage(page.dataUrl);
        if (text.trim()) sections.push({ text, type: 'page', metadata: { pageNumber: page.pageNumber, ocr: true } });
      }
      return {
        text: sections.map((section) => section.text).join('\n\n'),
        metadata: { pageCount: screenshots.total, source: filePath, parser: 'pdf-parse', ocr: true },
        sections,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`PDF备用解析失败 - 错误: ${message}`, error instanceof Error ? error.stack : undefined);
      throw new Error(`PDF文本提取与OCR失败: ${message}`);
    } finally {
      await parser.destroy();
    }
  }
}
