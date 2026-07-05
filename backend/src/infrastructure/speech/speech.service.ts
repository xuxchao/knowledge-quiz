import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as tencentcloud from 'tencentcloud-sdk-nodejs';
import { LoggerService, LogServiceCall } from '../../common/logger';

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

  constructor(private configService: ConfigService) {
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
    const base64Audio = audioBuffer.toString('base64');

    const params = {
      EngSerViceType: '16k_zh',
      SourceType: 1,
      VoiceFormat: format,
      Data: base64Audio,
    };

    const result = await this.asrClient.SentenceRecognition(params);
    return result.Result || '';
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
    const result = await ttsClient.TextToSpeech(params);
    return Buffer.from(result.Audio || '', 'base64');
  }

  @LogServiceCall()
  async batchSpeechToText(
    audioBuffer: Buffer,
    format: string = 'wav',
  ): Promise<{ result: string; startMs: number; endMs: number }[]> {
    const base64Audio = audioBuffer.toString('base64');

    const params = {
      EngSerViceType: '16k_zh',
      SourceType: 1,
      VoiceFormat: format,
      Data: base64Audio,
      WordInfo: 1,
    };

    const result = await this.asrClient.SentenceRecognition(params);
    const sentences = result.Result?.split('\n').filter(Boolean) || [];

    return sentences.map((sentence, index) => ({
      result: sentence,
      startMs: index * 3000,
      endMs: (index + 1) * 3000,
    }));
  }
}