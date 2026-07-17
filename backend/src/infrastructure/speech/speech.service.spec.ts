import { ConfigService } from '@nestjs/config';
import * as tencentcloud from 'tencentcloud-sdk-nodejs';
import { LangfuseService } from '../langfuse/langfuse.service';
import { SpeechService } from './speech.service';

jest.mock('tencentcloud-sdk-nodejs', () => ({
  asr: { v20190614: { Client: jest.fn() } },
  tts: { v20190823: { Client: jest.fn() } },
}));

describe('SpeechService', () => {
  const AsrClient = tencentcloud.asr.v20190614.Client as jest.Mock;
  const TtsClient = tencentcloud.tts.v20190823.Client as jest.Mock;
  let sentenceRecognition: jest.Mock;
  let textToSpeech: jest.Mock;
  let langfuseService: jest.Mocked<LangfuseService>;
  let service: SpeechService;

  beforeEach(() => {
    sentenceRecognition = jest.fn();
    textToSpeech = jest.fn();
    AsrClient.mockImplementation(() => ({ SentenceRecognition: sentenceRecognition }));
    TtsClient.mockImplementation(() => ({ TextToSpeech: textToSpeech }));
    langfuseService = {
      observeGeneration: jest.fn((_name, _options, operation) => operation()),
    } as unknown as jest.Mocked<LangfuseService>;
    service = new SpeechService(
      {
        get: jest.fn((_key: string, fallback?: string) => fallback),
      } as unknown as ConfigService,
      langfuseService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should trace ASR metadata without adding base64 audio to the observation', async () => {
    sentenceRecognition.mockResolvedValue({ Result: '识别结果' });
    const audio = Buffer.from('audio-data');

    await expect(service.speechToText(audio, 'wav')).resolves.toBe('识别结果');

    expect(langfuseService.observeGeneration).toHaveBeenCalledWith(
      'speech.asr',
      expect.objectContaining({
        attributes: expect.objectContaining({
          input: { format: 'wav', audioBytes: audio.length },
          model: 'tencent-asr-16k_zh',
        }),
      }),
      expect.any(Function),
    );
    expect(sentenceRecognition).toHaveBeenCalledWith(expect.objectContaining({ Data: audio.toString('base64') }));
    expect(JSON.stringify(langfuseService.observeGeneration.mock.calls[0][1])).not.toContain(audio.toString('base64'));
  });

  it('should trace TTS text and summarize binary output by byte count', async () => {
    textToSpeech.mockResolvedValue({ Audio: Buffer.from('wav-data').toString('base64') });

    const result = await service.textToSpeech('待合成文本');

    expect(result).toEqual(Buffer.from('wav-data'));
    const options = langfuseService.observeGeneration.mock.calls[0][1] as {
      attributes: { input: unknown };
      summarizeOutput: (audio: Buffer) => unknown;
    };
    expect(options.attributes.input).toBe('待合成文本');
    expect(options.summarizeOutput(result)).toEqual({ audioBytes: result.length, codec: 'wav' });
  });
});
