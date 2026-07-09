import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  CreateBucketCommand,
  ListBucketsCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { LoggerService, LogServiceCall } from '../../common/logger';

@Injectable()
export class RustfsService {
  private readonly logger = new LoggerService(RustfsService.name);
  private readonly s3Client: S3Client;
  private readonly bucket: string;

  constructor(private configService: ConfigService) {
    const endpoint = configService.get<string>('RUSTFS_ENDPOINT', 'http://localhost:9004');
    const accessKey = configService.get<string>('RUSTFS_ACCESS_KEY', 'rustfsadmin');
    const secretKey = configService.get<string>('RUSTFS_SECRET_KEY', 'rustfsadmin');
    const region = configService.get<string>('RUSTFS_REGION', 'us-east-1');

    this.bucket = configService.get<string>('RUSTFS_BUCKET', 'documents');

    this.s3Client = new S3Client({
      endpoint,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
      region,
      forcePathStyle: true,
    });

    this.logger.debug(`S3客户端已初始化: endpoint=${endpoint}, forcePathStyle=true, bucket=${this.bucket}`);

    void this.initializeBucket();
  }

  private async initializeBucket(): Promise<void> {
    try {
      const listBucketsCommand = new ListBucketsCommand({});
      const response = await this.s3Client.send(listBucketsCommand);
      const buckets = response.Buckets || [];

      const bucketExists = buckets.some((b) => b.Name === this.bucket);

      if (!bucketExists) {
        this.logger.info(`Bucket ${this.bucket}不存在，正在创建...`);
        const createBucketCommand = new CreateBucketCommand({
          Bucket: this.bucket,
        });
        await this.s3Client.send(createBucketCommand);
        this.logger.info(`Bucket ${this.bucket}创建成功`);
      }
    } catch (error) {
      const err = error as Error;
      this.logger.warn(`Bucket初始化失败: ${err.message}`);
    }
  }

  @LogServiceCall()
  async uploadFile(key: string, file: Buffer | Readable, contentType?: string): Promise<string> {
    this.logger.debug(`上传文件: key=${key}, contentType=${contentType || '未指定'}`);
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file,
        ContentType: contentType,
      });

      await this.s3Client.send(command);

      return this.getFileUrl(key);
    } catch (error) {
      const err = error as Error;
      throw new Error(`文件上传失败: ${err.message}`);
    }
  }

  @LogServiceCall()
  async downloadFile(key: string): Promise<Buffer> {
    this.logger.debug(`下载文件: key=${key}`);
    try {
      return await this.downloadObject(key);
    } catch (error) {
      const legacyEncodedKey = this.encodeKeyForUrl(key);
      if (this.isObjectNotFoundError(error) && legacyEncodedKey !== key) {
        this.logger.warn(`文件下载未找到原始key，尝试兼容旧编码key: ${legacyEncodedKey}`);
        try {
          return await this.downloadObject(legacyEncodedKey);
        } catch (legacyError) {
          const err = legacyError as Error;
          throw new Error(`文件下载失败: ${err.message}`);
        }
      }

      const err = error as Error;
      throw new Error(`文件下载失败: ${err.message}`);
    }
  }

  @LogServiceCall()
  async deleteFile(key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      await this.s3Client.send(command);
    } catch (error) {
      const err = error as Error;
      throw new Error(`文件删除失败: ${err.message}`);
    }
  }

  @LogServiceCall()
  async fileExists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      await this.s3Client.send(command);
      return true;
    } catch (error) {
      const err = error as Error;
      if (err.name === 'NotFound') {
        return false;
      }
      throw err;
    }
  }

  getFileUrl(key: string): string {
    return `${this.configService.get<string>('RUSTFS_ENDPOINT')}/${this.bucket}/${this.encodeKeyForUrl(key)}`;
  }

  getBucket(): string {
    return this.bucket;
  }

  private async downloadObject(key: string): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const response = await this.s3Client.send(command);
    const stream = response.Body as Readable;

    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  private encodeKeyForUrl(key: string): string {
    return key.split('/').map(encodeURIComponent).join('/');
  }

  private isObjectNotFoundError(error: unknown): boolean {
    const err = error as {
      name?: string;
      Code?: string;
      message?: string;
      $metadata?: { httpStatusCode?: number };
    };

    return (
      err.name === 'NoSuchKey' ||
      err.name === 'NotFound' ||
      err.Code === 'NoSuchKey' ||
      err.$metadata?.httpStatusCode === 404 ||
      err.message?.includes('specified key does not exist') === true
    );
  }
}
