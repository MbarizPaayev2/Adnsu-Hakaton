import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';

// Extensions are assigned server-side from a fixed allowlist, never derived
// from the client-supplied filename — that filename is fully attacker
// controlled (multipart `originalname`) and must never reach path.join().
const SAFE_EXTENSIONS: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

export const DOCUMENT_MIME_TYPES = Object.keys(SAFE_EXTENSIONS).filter((t) => !t.startsWith('image/'));
export const IMAGE_MIME_TYPES = Object.keys(SAFE_EXTENSIONS).filter((t) => t.startsWith('image/'));

@Injectable()
export class LocalStorageService {
  private uploadDir = path.join(process.cwd(), 'uploads');

  constructor() {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  private safeExtension(mimetype: string | undefined): string {
    return SAFE_EXTENSIONS[mimetype || ''] || '.bin';
  }

  private resolveInUploadDir(filename: string): string {
    const filePath = path.join(this.uploadDir, filename);
    // Defense in depth: even though filenames are now server-generated, refuse
    // to write/delete anywhere the resolved path escapes uploadDir.
    if (!filePath.startsWith(this.uploadDir + path.sep)) {
      throw new BadRequestException('Fayl yolu etibarsızdır');
    }
    return filePath;
  }

  async uploadFile(file: Express.Multer.File): Promise<string> {
    const filename = `${randomUUID()}${this.safeExtension(file.mimetype)}`;
    const filePath = this.resolveInUploadDir(filename);

    await fs.promises.writeFile(filePath, file.buffer);

    // Return a relative URL that can be served by express static middleware
    return `/uploads/${filename}`;
  }

  async uploadBuffer(buffer: Buffer, mimetype = 'application/pdf'): Promise<string> {
    const filename = `${randomUUID()}${this.safeExtension(mimetype)}`;
    const filePath = this.resolveInUploadDir(filename);

    await fs.promises.writeFile(filePath, buffer);

    return `/uploads/${filename}`;
  }

  // Copies stored bytes to a fresh, never-reused name so the copy is immune to
  // later replacement/deletion of the source. Rejects with ENOENT if the source
  // is already gone; a partially written copy is removed.
  async copyFile(fileUrl: string): Promise<string> {
    const source = this.resolveInUploadDir(path.basename(fileUrl));
    const filename = `${randomUUID()}${path.extname(source)}`;
    const target = this.resolveInUploadDir(filename);
    try {
      await fs.promises.copyFile(source, target, fs.constants.COPYFILE_EXCL);
    } catch (error) {
      await fs.promises.unlink(target).catch(() => undefined);
      throw error;
    }
    return `/uploads/${filename}`;
  }

  async deleteFile(fileUrl: string): Promise<void> {
    const filename = path.basename(fileUrl);
    const filePath = this.resolveInUploadDir(filename);

    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath).catch((err) => {
        console.error(`Failed to delete file: ${filePath}`, err);
      });
    }
  }

  fileExists(fileUrl: string | null | undefined): boolean {
    if (!fileUrl) return false;
    const filename = path.basename(fileUrl);
    return fs.existsSync(this.resolveInUploadDir(filename));
  }

  /** SHA-256 of stored bytes; rejects with ENOENT if the file is gone. */
  async sha256(fileUrl: string): Promise<string> {
    const filePath = this.resolveInUploadDir(path.basename(fileUrl));
    const hash = createHash('sha256');
    for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer);
    return hash.digest('hex');
  }

  // ── Private snapshots ──────────────────────────────────────────────────────
  // Documents sent to an employer are copied into a directory that the public
  // /uploads route can never reach and are addressed by an opaque key, not a
  // URL. They are read back only through owner-checked server code.
  private static PRIVATE_KEY = /^private\/email-applications\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|docx)$/;

  private resolvePrivate(key: string): string {
    if (!LocalStorageService.PRIVATE_KEY.test(key)) throw new BadRequestException('Fayl yolu etibarsızdır');
    return path.join(this.uploadDir, ...key.split('/'));
  }

  /** Copies an uploaded document into private storage and returns its opaque key. */
  async copyToPrivate(fileUrl: string): Promise<string> {
    const source = this.resolveInUploadDir(path.basename(fileUrl));
    const ext = path.extname(source);
    if (!['.pdf', '.docx'].includes(ext)) throw new BadRequestException('Yalnız PDF və DOCX göndərilə bilər');
    const key = `private/email-applications/${randomUUID()}${ext}`;
    const target = this.resolvePrivate(key);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    try {
      await fs.promises.copyFile(source, target, fs.constants.COPYFILE_EXCL);
    } catch (error) {
      await fs.promises.unlink(target).catch(() => undefined);
      throw error;
    }
    return key;
  }

  async readPrivate(key: string): Promise<Buffer> {
    return fs.promises.readFile(this.resolvePrivate(key));
  }

  async deletePrivate(key: string): Promise<void> {
    await fs.promises.unlink(this.resolvePrivate(key)).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }

  /** Bytes of a stored upload (the live source of a document, before it is snapshotted). */
  async readUpload(fileUrl: string): Promise<Buffer> {
    return fs.promises.readFile(this.resolveInUploadDir(path.basename(fileUrl)));
  }

  // Used by UploadsController to serve a file back out. Same traversal guard
  // as writes/deletes: only ever resolves within uploadDir, never trusts the
  // requested segment beyond its basename.
  resolveForRead(requestedFilename: string): string {
    const filename = path.basename(requestedFilename);
    const filePath = this.resolveInUploadDir(filename);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Fayl tapılmadı');
    }
    return filePath;
  }
}
