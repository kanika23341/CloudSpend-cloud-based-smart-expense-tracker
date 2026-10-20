const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const config = require('../config');

class S3Service {
  constructor() {
    this.client = null;
  }

  getClient() {
    if (!this.client) {
      const clientOptions = {
        region: config.aws.region
      };
      if (config.aws.credentials) {
        clientOptions.credentials = config.aws.credentials;
      }
      this.client = new S3Client(clientOptions);
    }
    return this.client;
  }

  isConfigured() {
    return Boolean(config.aws.s3.bucketName);
  }

  /**
   * Generates a presigned PUT URL for direct browser-to-S3 receipt uploads.
   * Eliminates sending large receipt files through the web application server.
   */
  async getPresignedUploadUrl(userId, filename, contentType = 'image/jpeg') {
    if (!this.isConfigured()) {
      return null;
    }

    const client = this.getClient();
    const sanitizedFilename = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `receipts/${userId}/${uuidv4()}-${sanitizedFilename}`;

    const command = new PutObjectCommand({
      Bucket: config.aws.s3.bucketName,
      Key: key,
      ContentType: contentType
    });

    const uploadUrl = await getSignedUrl(client, command, {
      expiresIn: config.aws.s3.presignedExpires
    });

    return {
      uploadUrl,
      key,
      bucket: config.aws.s3.bucketName,
      expiresIn: config.aws.s3.presignedExpires
    };
  }

  /**
   * Generates a temporary presigned GET URL for downloading/viewing receipts securely.
   */
  async getPresignedDownloadUrl(key, expiresIn = 3600) {
    if (!this.isConfigured()) {
      return null;
    }

    const client = this.getClient();
    const command = new GetObjectCommand({
      Bucket: config.aws.s3.bucketName,
      Key: key
    });

    return getSignedUrl(client, command, { expiresIn });
  }

  /**
   * Uploads an export document (CSV / JSON) directly to S3.
   */
  async uploadExportFile(key, buffer, contentType = 'text/csv') {
    if (!this.isConfigured()) {
      // Local fallback: save to data/exports/
      const localPath = path.resolve(process.cwd(), 'data/exports', path.basename(key));
      fs.writeFileSync(localPath, buffer);
      return {
        local: true,
        path: `/exports/${path.basename(key)}`,
        key: path.basename(key)
      };
    }

    const client = this.getClient();
    const command = new PutObjectCommand({
      Bucket: config.aws.s3.bucketName,
      Key: key,
      Body: buffer,
      ContentType: contentType
    });

    await client.send(command);
    const downloadUrl = await this.getPresignedDownloadUrl(key, 86400); // 24hr download link

    return {
      s3: true,
      key,
      bucket: config.aws.s3.bucketName,
      downloadUrl
    };
  }
}

module.exports = new S3Service();
