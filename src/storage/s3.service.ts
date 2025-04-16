import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as AWS from 'aws-sdk';
import { Readable } from 'stream';

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private s3: AWS.S3;
  private readonly bucket: string;

  constructor(private configService: ConfigService) {
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');
    const region = this.configService.get<string>('AWS_REGION');
    this.bucket = this.configService.get<string>('S3_BUCKET_NAME');
    
    const s3Config: AWS.S3.ClientConfiguration = {
      accessKeyId,
      secretAccessKey,
      region,
    };
    this.s3 = new AWS.S3(s3Config);
  }

  async uploadFile(
    key: string,
    fileContent: Buffer | Readable,
    mimeType?: string,
  ): Promise<string> {
    try {
      this.logger.log(`Uploading file to S3: ${key}`);
      
      const params: AWS.S3.PutObjectRequest = {
        Bucket: this.bucket,
        Key: key,
        Body: fileContent,
        ContentType: mimeType,
      };
      
      const result = await this.s3.upload(params).promise();
      this.logger.log(`Successfully uploaded file to S3: ${key}`);
      
      return result.Location;
    } catch (error) {
      this.logger.error(`Error uploading file to S3: ${error.message}`);
      throw error;
    }
  }

  async getFile(key: string): Promise<Buffer | null> {
    try {
      this.logger.log(`Downloading file from S3: ${key}`);
      
      // Check if file exists first
      const exists = await this.fileExists(key);
      if (!exists) {
        this.logger.warn(`File does not exist in S3: ${key}`);
        return null;
      }
      
      const params: AWS.S3.GetObjectRequest = {
        Bucket: this.bucket,
        Key: key,
      };
      
      const result = await this.s3.getObject(params).promise();
      this.logger.log(`Successfully downloaded file from S3: ${key}`);
      
      return result.Body as Buffer;
    } catch (error) {
      this.logger.error(`Error downloading file from S3: ${error.message}`);
      throw error;
    }
  }

  async deleteFile(key: string): Promise<void> {
    try {
      this.logger.log(`Deleting file from S3: ${key}`);
      
      const params: AWS.S3.DeleteObjectRequest = {
        Bucket: this.bucket,
        Key: key,
      };
      
      await this.s3.deleteObject(params).promise();
      this.logger.log(`Successfully deleted file from S3: ${key}`);
    } catch (error) {
      this.logger.error(`Error deleting file from S3: ${error.message}`);
      throw error;
    }
  }

  async fileExists(key: string): Promise<boolean> {
    try {
      const params: AWS.S3.HeadObjectRequest = {
        Bucket: this.bucket,
        Key: key,
      };
      
      await this.s3.headObject(params).promise();
      return true;
    } catch (error) {
      if (error.code === 'NotFound') {
        return false;
      }
      throw error;
    }
  }

  getSignedUrl(key: string, expiresIn = 3600): string {
    try {
      const params: AWS.S3.GetObjectRequest = {
        Bucket: this.bucket,
        Key: key,
      };
      
      return this.s3.getSignedUrl('getObject', { ...params, Expires: expiresIn });
    } catch (error) {
      this.logger.error(`Error generating signed URL: ${error.message}`);
      throw error;
    }
  }
}