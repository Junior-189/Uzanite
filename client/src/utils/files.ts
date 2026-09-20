import api from './api';

export interface UploadedFile {
  id: string;
  key: string;
  url: string;
  contentType: string;
  size: number;
  originalName: string;
}

export type FilePurpose = 'product_image' | 'payment_proof' | 'other';

/**
 * Uploads a private file to the platform (`POST /api/v1/files`) and returns its
 * opaque key + a short-lived signed URL. Used for product images and payment
 * proofs once those domains are served by the platform.
 */
export async function uploadFile(file: File, purpose: FilePurpose = 'other'): Promise<UploadedFile> {
  const form = new FormData();
  form.append('file', file);
  form.append('purpose', purpose);
  const res = (await api.post('/files', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })) as { success?: boolean; file?: UploadedFile; error?: string };
  if (!res?.success || !res.file) throw new Error(res?.error || 'Upload failed');
  return res.file;
}

/** Mints a fresh signed URL for a previously uploaded key (tenant-scoped). */
export async function getSignedFileUrl(key: string): Promise<string | null> {
  if (!key) return null;
  try {
    const res = (await api.get(`/files/${encodeURIComponent(key)}/url`)) as { success?: boolean; url?: string };
    return res?.success && res.url ? res.url : null;
  } catch {
    return null;
  }
}
