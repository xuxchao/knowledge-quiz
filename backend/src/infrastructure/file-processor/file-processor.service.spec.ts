import { Test, TestingModule } from '@nestjs/testing';
import * as fs from 'fs';
import * as path from 'path';
import { FileProcessorService } from './file-processor.service';
import { FileType } from '../../entities/document.entity';
import { AiService } from '../../ai/ai.service';
import { SpeechService } from '../speech/speech.service';
import { RustfsService } from '../rustfs/rustfs.service';

describe('FileProcessorService', () => {
  let service: FileProcessorService;
  let aiService: jest.Mocked<Record<string, jest.Mock>>;
  let speechService: jest.Mocked<Record<string, jest.Mock>>;
  let rustfsService: jest.Mocked<Record<string, jest.Mock>>;

  const testTxtPath = path.join(process.cwd(), 'test.txt');
  const testMdPath = path.join(process.cwd(), 'test.md');
  const testJsonPath = path.join(process.cwd(), 'test.json');
  const testMp3Path = path.join(process.cwd(), 'test.mp3');
  const testMp4Path = path.join(process.cwd(), 'test.mp4');

  beforeEach(async () => {
    fs.writeFileSync(testTxtPath, 'test content');
    fs.writeFileSync(testMdPath, 'test content');
    fs.writeFileSync(testJsonPath, JSON.stringify({ key: 'value', num: 123 }));
    fs.writeFileSync(testMp3Path, 'audio content');
    fs.writeFileSync(testMp4Path, 'video content');

    aiService = {
      getChatModel: jest.fn().mockReturnValue({
        invoke: jest.fn().mockResolvedValue({ content: 'Image description' }),
      }),
      describeImage: jest.fn().mockResolvedValue('Image description'),
      generateEmbeddings: jest.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
    };

    speechService = {
      speechToText: jest.fn().mockResolvedValue('Transcribed text'),
      batchSpeechToText: jest.fn().mockResolvedValue([{ result: 'Transcribed text', startMs: 0, endMs: 3000 }]),
    };

    rustfsService = {
      getBucket: jest.fn().mockReturnValue('documents'),
      downloadFile: jest.fn().mockResolvedValue(Buffer.from('test content')),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileProcessorService,
        { provide: AiService, useValue: aiService },
        { provide: SpeechService, useValue: speechService },
        { provide: RustfsService, useValue: rustfsService },
      ],
    }).compile();

    service = module.get<FileProcessorService>(FileProcessorService);
  });

  afterEach(() => {
    jest.resetAllMocks();
    if (fs.existsSync(testTxtPath)) {
      fs.unlinkSync(testTxtPath);
    }
    if (fs.existsSync(testMdPath)) {
      fs.unlinkSync(testMdPath);
    }
    if (fs.existsSync(testJsonPath)) {
      fs.unlinkSync(testJsonPath);
    }
    if (fs.existsSync(testMp3Path)) {
      fs.unlinkSync(testMp3Path);
    }
    if (fs.existsSync(testMp4Path)) {
      fs.unlinkSync(testMp4Path);
    }
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getFileBuffer', () => {
    it('should decode RustFS URLs to raw object keys before downloading', async () => {
      await service.getFileBuffer('http://localhost:9004/documents/test-doc/%E6%B5%8B%E8%AF%95%E6%96%87%E6%A1%A3.md');

      expect(rustfsService.downloadFile).toHaveBeenCalledWith('test-doc/测试文档.md');
    });
  });

  describe('chunkText', () => {
    it('should split text into chunks', async () => {
      const text = 'Hello world. This is a test. Another sentence here.';

      const chunks = await service.chunkText(text, 20, 5);

      expect(Array.isArray(chunks)).toBe(true);
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should handle small text without chunking', async () => {
      const text = 'Short text';

      const chunks = await service.chunkText(text, 100, 10);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe(text);
    });

    it('should handle empty text', async () => {
      const chunks = await service.chunkText('');

      expect(chunks).toEqual([]);
    });

    it('should respect chunkSize and chunkOverlap', async () => {
      const text = 'A'.repeat(600);

      const chunks = await service.chunkText(text, 200, 50);

      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((chunk) => {
        expect(chunk.length).toBeLessThanOrEqual(200);
      });
    });
  });

  describe('splitSections', () => {
    it('should preserve source location and calculate token counts', async () => {
      const chunks = await service.splitSections([
        { text: '第一行内容', type: 'table-row', metadata: { sheetName: 'Sheet1', rowRange: '2:2' } },
      ]);

      expect(chunks).toEqual([
        expect.objectContaining({ tokenCount: expect.any(Number), metadata: { sheetName: 'Sheet1', rowRange: '2:2' } }),
      ]);
    });
  });

  describe('storeChunks', () => {
    it('should store chunks with embeddings', async () => {
      const chunks = ['chunk1', 'chunk2'];
      const embeddings = [
        [0.1, 0.2],
        [0.3, 0.4],
      ];

      aiService.generateEmbeddings.mockResolvedValue(embeddings);

      await service.storeChunks('doc-1', chunks);

      expect(aiService.generateEmbeddings).toHaveBeenCalledWith(chunks);
      await expect(service.storeChunks('doc-1', chunks)).resolves.toHaveLength(2);
    });

    it('should handle empty chunks', async () => {
      await service.storeChunks('doc-1', []);

      expect(aiService.generateEmbeddings).not.toHaveBeenCalled();
    });
  });

  describe('processFile', () => {
    it('should throw error for unsupported file type', async () => {
      await expect(service.processFile('test.xxx', 'test.xxx', 'unknown' as FileType)).rejects.toThrow(/unknown/);
    });

    it('should process PDF files', async () => {
      const loadSpy = jest
        .spyOn<any, any>(service as any, 'loadWithLoader')
        .mockResolvedValue({ text: 'pdf text content long enough to index', metadata: {} });
      const result = await service.processFile('test.pdf', 'test.pdf', FileType.PDF);

      expect(loadSpy).toHaveBeenCalled();
      expect(result).toHaveProperty('text', 'pdf text content long enough to index');
    });

    it('should process TXT files', async () => {
      const result = await service.processFile('test.txt', 'test.txt', FileType.TXT);

      expect(result).toHaveProperty('text');
      expect(result.text).toBe('test content');
    });

    it('should process MD files', async () => {
      const result = await service.processFile('test.md', 'test.md', FileType.MD);

      expect(result).toHaveProperty('text');
      expect(result.text).toBe('test content');
    });

    it('should process DOCX files', async () => {
      const loadSpy = jest
        .spyOn<any, any>(service as any, 'loadWithLoader')
        .mockResolvedValue({ text: 'docx text', metadata: {} });
      const result = await service.processFile('test.docx', 'test.docx', FileType.DOCX);

      expect(loadSpy).toHaveBeenCalled();
      expect(result).toHaveProperty('text', 'docx text');
    });

    it('should process PPTX files', async () => {
      const loadSpy = jest
        .spyOn<any, any>(service as any, 'loadWithLoader')
        .mockResolvedValue({ text: 'pptx text', metadata: {} });
      const result = await service.processFile('test.pptx', 'test.pptx', FileType.PPTX);

      expect(loadSpy).toHaveBeenCalled();
      expect(result).toHaveProperty('text', 'pptx text');
    });

    it('should process URL', async () => {
      const processUrlSpy = jest
        .spyOn<any, any>(service as any, 'processUrl')
        .mockResolvedValue({ text: 'url text', metadata: {} });
      const result = await service.processFile('https://example.com', 'https://example.com', FileType.URL);

      expect(processUrlSpy).toHaveBeenCalled();
      expect(result).toHaveProperty('text', 'url text');
      expect(result).toHaveProperty('metadata');
    });
  });

  describe('processJson', () => {
    it('should process JSON file', async () => {
      rustfsService.downloadFile.mockResolvedValue(Buffer.from(JSON.stringify({ key: 'value', num: 123 })));

      const result = await service.processFile('test.json', 'test.json', FileType.JSON);

      expect(result).toHaveProperty('text');
      expect(result).toHaveProperty('metadata');
      expect(result.metadata).toHaveProperty('keys');
    });

    it('should handle invalid JSON', async () => {
      rustfsService.downloadFile.mockResolvedValue(Buffer.from('invalid json'));

      await expect(
        service.processFile('http://example.com/test.json', 'http://example.com/test.json', FileType.JSON),
      ).rejects.toThrow();
    });
  });

  describe('processAudio', () => {
    it('should process audio file', async () => {
      rustfsService.downloadFile.mockResolvedValue(Buffer.from('audio data'));

      const result = await service.processFile('test.mp3', 'test.mp3', FileType.AUDIO);

      expect(result).toHaveProperty('text');
      expect(result.text).toBe('Transcribed text');
      expect(speechService.batchSpeechToText).toHaveBeenCalledWith(expect.any(Buffer), 'mp3');
    });
  });

  describe('processVideo', () => {
    it('should fail explicitly when FFmpeg is unavailable instead of indexing placeholder text', async () => {
      rustfsService.downloadFile.mockResolvedValue(Buffer.from('video data'));

      await expect(service.processFile('test.mp4', 'test.mp4', FileType.VIDEO)).rejects.toThrow(/FFmpeg/);
    });
  });
});
