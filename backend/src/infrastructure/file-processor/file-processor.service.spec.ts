import { Test, TestingModule } from '@nestjs/testing';
import { FileProcessorService } from './file-processor.service';
import { FileType } from '../../entities/document.entity';
import { AiService } from '../../ai/ai.service';
import { SpeechService } from '../speech/speech.service';
import { Neo4jService } from '../neo4j/neo4j.service';
import { RustfsService } from '../rustfs/rustfs.service';

describe('FileProcessorService', () => {
  let service: FileProcessorService;
  let aiService: jest.Mocked<Record<string, jest.Mock>>;
  let speechService: jest.Mocked<Record<string, jest.Mock>>;
  let neo4jService: jest.Mocked<Record<string, jest.Mock>>;
  let rustfsService: jest.Mocked<Record<string, jest.Mock>>;

  beforeEach(async () => {
    aiService = {
      getChatModel: jest.fn().mockReturnValue({
        invoke: jest.fn().mockResolvedValue({ content: 'Image description' }),
      }),
      generateEmbeddings: jest.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
    };

    speechService = {
      speechToText: jest.fn().mockResolvedValue('Transcribed text'),
    };

    neo4jService = {
      addDocuments: jest.fn().mockResolvedValue(),
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
        { provide: Neo4jService, useValue: neo4jService },
        { provide: RustfsService, useValue: rustfsService },
      ],
    }).compile();

    service = module.get<FileProcessorService>(FileProcessorService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('chunkText', () => {
    it('should split text into chunks', () => {
      const text = 'Hello world. This is a test. Another sentence here.';

      const chunks = service.chunkText(text, 20, 5);

      expect(Array.isArray(chunks)).toBe(true);
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should handle small text without chunking', () => {
      const text = 'Short text';

      const chunks = service.chunkText(text, 100, 10);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe(text);
    });

    it('should handle empty text', () => {
      const chunks = service.chunkText('');

      expect(chunks).toEqual([]);
    });

    it('should respect chunkSize and chunkOverlap', () => {
      const text = 'A'.repeat(600);

      const chunks = service.chunkText(text, 200, 50);

      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((chunk) => {
        expect(chunk.length).toBeLessThanOrEqual(200);
      });
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
      expect(neo4jService.addDocuments).toHaveBeenCalledWith(
        [
          {
            content: 'chunk1',
            metadata: { documentId: 'doc-1', chunkIndex: 0, totalChunks: 2 },
          },
          {
            content: 'chunk2',
            metadata: { documentId: 'doc-1', chunkIndex: 1, totalChunks: 2 },
          },
        ],
        embeddings,
      );
    });

    it('should handle empty chunks', async () => {
      await service.storeChunks('doc-1', []);

      expect(aiService.generateEmbeddings).not.toHaveBeenCalled();
      expect(neo4jService.addDocuments).not.toHaveBeenCalled();
    });
  });

  describe('processFile', () => {
    it('should throw error for unsupported file type', async () => {
      await expect(service.processFile('test.xxx', 'test.xxx', 'unknown' as FileType)).rejects.toThrow(
        'Unsupported file type: unknown',
      );
    });

    it('should process PDF files', async () => {
      const result = await service.processFile('test.pdf', 'test.pdf', FileType.PDF);

      expect(result).toHaveProperty('text');
      expect(result).toHaveProperty('metadata');
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
      const result = await service.processFile('test.docx', 'test.docx', FileType.DOCX);

      expect(result).toHaveProperty('text');
    });

    it('should process PPTX files', async () => {
      const result = await service.processFile('test.pptx', 'test.pptx', FileType.PPTX);

      expect(result).toHaveProperty('text');
      expect(result.text).toContain('PPTX processing');
    });

    it('should process URL', async () => {
      const result = await service.processFile('https://example.com', 'https://example.com', FileType.URL);

      expect(result).toHaveProperty('text');
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

      await expect(service.processFile('test.json', 'test.json', FileType.JSON)).rejects.toThrow();
    });
  });

  describe('processAudio', () => {
    it('should process audio file', async () => {
      rustfsService.downloadFile.mockResolvedValue(Buffer.from('audio data'));

      const result = await service.processFile('test.mp3', 'test.mp3', FileType.AUDIO);

      expect(result).toHaveProperty('text');
      expect(result.text).toBe('Transcribed text');
      expect(speechService.speechToText).toHaveBeenCalled();
    });
  });

  describe('processVideo', () => {
    it('should process video file', async () => {
      rustfsService.downloadFile.mockResolvedValue(Buffer.from('video data'));

      const result = await service.processFile('test.mp4', 'test.mp4', FileType.VIDEO);

      expect(result).toHaveProperty('text');
      expect(result.text).toContain('视频处理');
    });
  });
});
