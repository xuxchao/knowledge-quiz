import { Injectable, Logger } from '@nestjs/common';
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

@Injectable()
export class RustfsService {
  private readonly logger = new Logger(RustfsService.name);
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

    this.logger.debug(`S3Client initialized: endpoint=${endpoint}, forcePathStyle=${true}, bucket=${this.bucket}`);

    void this.initializeBucket();
  }

  private async initializeBucket(): Promise<void> {
    try {
      const listBucketsCommand = new ListBucketsCommand({});
      const response = await this.s3Client.send(listBucketsCommand);
      const buckets = response.Buckets || [];

      const bucketExists = buckets.some((b) => b.Name === this.bucket);

      if (!bucketExists) {
        this.logger.log(`Bucket ${this.bucket} does not exist, creating...`);
        const createBucketCommand = new CreateBucketCommand({
          Bucket: this.bucket,
        });
        await this.s3Client.send(createBucketCommand);
        this.logger.log(`Bucket ${this.bucket} created successfully`);
      }
    } catch (error) {
      const err = error as Error;
      this.logger.warn(`Failed to initialize bucket: ${err.message}`);
    }
  }

  async uploadFile(key: string, file: Buffer | Readable, contentType?: string): Promise<string> {
    this.logger.debug(`Uploading file to RustFS: ${key}`);

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file,
        ContentType: contentType,
      });

      await this.s3Client.send(command);

      const url = `${this.configService.get<string>('RUSTFS_ENDPOINT')}/${this.bucket}/${key}`;
      this.logger.debug(`File uploaded successfully: ${url}`);
      return url;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to upload file: ${err.message}`, err.stack);
      throw new Error(`Failed to upload file to RustFS: ${err.message}`);
    }
  }

  async downloadFile(key: string): Promise<Buffer> {
    this.logger.debug(`Downloading file from RustFS: ${key}`);

    try {
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
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to download file: ${err.message}`, err.stack);
      throw new Error(`Failed to download file from RustFS: ${err.message}`);
    }
  }

  async deleteFile(key: string): Promise<void> {
    this.logger.debug(`Deleting file from RustFS: ${key}`);

    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      await this.s3Client.send(command);
      this.logger.debug(`File deleted successfully: ${key}`);
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to delete file: ${err.message}`, err.stack);
      throw new Error(`Failed to delete file from RustFS: ${err.message}`);
    }
  }

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
      this.logger.error(`Error checking file existence: ${err.message}`, err.stack);
      throw err;
    }
  }

  getFileUrl(key: string): string {
    return `${this.configService.get<string>('RUSTFS_ENDPOINT')}/${this.bucket}/${key}`;
  }

  getBucket(): string {
    return this.bucket;
  }
}
