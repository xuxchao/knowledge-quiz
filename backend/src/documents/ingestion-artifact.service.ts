import { Injectable } from '@nestjs/common';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { RustfsService } from '../infrastructure/rustfs/rustfs.service';
import { LogServiceCall } from '../common/logger';

@Injectable()
export class IngestionArtifactService {
  private readonly gzipAsync = promisify(gzip);
  private readonly gunzipAsync = promisify(gunzip);

  constructor(private readonly rustfsService: RustfsService) {}

  @LogServiceCall()
  async writeJson(runId: string, name: string, value: unknown): Promise<string> {
    const key = `_ingestion/${runId}/${name}.json.gz`;
    const compressed = await this.gzipAsync(Buffer.from(JSON.stringify(value), 'utf8'));
    await this.rustfsService.uploadFile(key, compressed, 'application/gzip');
    return key;
  }

  @LogServiceCall()
  async readJson<T>(key: string): Promise<T> {
    const compressed = await this.rustfsService.downloadFile(key);
    const content = await this.gunzipAsync(compressed);
    return JSON.parse(content.toString('utf8')) as T;
  }

  @LogServiceCall()
  async cleanup(keys: Array<string | undefined>): Promise<void> {
    await Promise.allSettled(
      keys.filter((key): key is string => Boolean(key)).map((key) => this.rustfsService.deleteFile(key)),
    );
  }
}
