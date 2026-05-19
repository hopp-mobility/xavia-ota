import AdmZip from 'adm-zip';

export class ZipHelper {
  static async getFileFromZip(zip: AdmZip, filePath: string): Promise<Buffer> {
    const entries = zip.getEntries();
    const entry = entries.find((entry) => entry.entryName === filePath);
    if (!entry) throw new Error(`File not found in zip: ${filePath}`);
    return entry.getData();
  }
}
