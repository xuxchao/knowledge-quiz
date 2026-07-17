import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as tencentcloud from 'tencentcloud-sdk-nodejs';
import { LoggerService, LogServiceCall } from '../../common/logger';
import { LangfuseService } from '../langfuse/langfuse.service';

const AsrClient = tencentcloud.asr.v20190614.Client;
const TtsClient = tencentcloud.tts.v20190823.Client;

type AsrClientType = typeof AsrClient.prototype;
type TtsClientType = typeof TtsClient.prototype;

interface TextToSpeechParams {
  Text: string;
  SessionId: string;
  VoiceType: number;
  Speed: number;
  Volume: number;
  SampleRate: number;
  Codec: string;
}

interface TextToSpeechResult {
  Audio?: string;
  RequestId?: string;
}

@Injectable()
export class SpeechService {
  private readonly logger = new LoggerService(SpeechService.name);
  private asrClient: AsrClientType;
  private ttsClient: TtsClientType;

  constructor(
    private readonly configService: ConfigService,
    private readonly langfuseService: LangfuseService,
  ) {
    const secretId = this.configService.get<string>('TENCENT_SECRET_ID');
    const secretKey = this.configService.get<string>('TENCENT_SECRET_KEY');
    const region = this.configService.get<string>('TENCENT_REGION', 'ap-beijing');

    const credential = {
      secretId,
      secretKey,
    };

    this.asrClient = new AsrClient({
      credential,
      region,
    });

    this.ttsClient = new TtsClient({
      credential,
      region,
    });

    this.logger.info('语音服务初始化完成');
  }

  @LogServiceCall()
  async speechToText(audioBuffer: Buffer, format: string = 'wav'): Promise<string> {
    return this.langfuseService.observeGeneration(
      'speech.asr',
      {
        attributes: {
          input: { format, audioBytes: audioBuffer.length },
          model: 'tencent-asr-16k_zh',
          modelParameters: { sourceType: 1 },
        },
      },
      async () => {
        const result = await this.asrClient.SentenceRecognition({
          EngSerViceType: '16k_zh',
          SourceType: 1,
          VoiceFormat: format,
          Data: audioBuffer.toString('base64'),
        });
        return result.Result || '';
      },
    );
  }

  @LogServiceCall()
  async textToSpeech(text: string): Promise<Buffer> {
    const params: TextToSpeechParams = {
      Text: text,
      SessionId: `${Date.now()}`,
      VoiceType: 101001,
      Speed: 0,
      Volume: 5,
      SampleRate: 16000,
      Codec: 'wav',
    };

    const ttsClient = this.ttsClient as unknown as {
      TextToSpeech: (params: TextToSpeechParams) => Promise<TextToSpeechResult>;
    };
    return this.langfuseService.observeGeneration(
      'speech.tts',
      {
        attributes: {
          input: text,
          model: `tencent-tts-${params.VoiceType}`,
          modelParameters: {
            speed: params.Speed,
            volume: params.Volume,
            sampleRate: params.SampleRate,
          },
        },
        summarizeOutput: (audio) => ({ audioBytes: audio.length, codec: params.Codec }),
      },
      async () => {
        const result = await ttsClient.TextToSpeech(params);
        return Buffer.from(result.Audio || '', 'base64');
      },
    );
  }

  @LogServiceCall()
  async batchSpeechToText(
    audioBuffer: Buffer,
    format: string = 'wav',
  ): Promise<{ result: string; startMs: number; endMs: number }[]> {
    return this.langfuseService.observeGeneration(
      'speech.asr.batch',
      {
        attributes: {
          input: { format, audioBytes: audioBuffer.length },
          model: 'tencent-asr-16k_zh',
          modelParameters: { sourceType: 1, wordInfo: 1 },
        },
      },
      async () => {
        const result = await this.asrClient.SentenceRecognition({
          EngSerViceType: '16k_zh',
          SourceType: 1,
          VoiceFormat: format,
          Data: audioBuffer.toString('base64'),
          WordInfo: 1,
        });
        const sentences = result.Result?.split('\n').filter(Boolean) || [];
        return sentences.map((sentence, index) => ({
          result: sentence,
          startMs: index * 3000,
          endMs: (index + 1) * 3000,
        }));
      },
    );
  }
}
