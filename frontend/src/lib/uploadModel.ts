import { uploadImage, uploadYoutube } from './uploadApi';
import type { UploadResult } from './uploadApi';
import type { FieldErrors } from './authApi';

export type UploadMode = 'image' | 'youtube';

export type UploadValues = { title: string; file: File | null; youtube: string };

// Client-side pre-check: in image mode a file is required. The server stays authoritative
// for everything else (type/size/well-formedness, YouTube parsing).
export function validateUpload(mode: UploadMode, values: UploadValues): FieldErrors {
  if (mode === 'image' && values.file === null) {
    return { image: ['Choose an image to upload.'] };
  }
  return {};
}

// Dispatch a submission to the right endpoint for the active mode. Pure glue over uploadApi
// so the page/hook stays thin and this decision is unit-testable.
export function submitUpload(mode: UploadMode, values: UploadValues): Promise<UploadResult> {
  if (mode === 'image') {
    return uploadImage({ title: values.title, file: values.file as File });
  }
  return uploadYoutube({ title: values.title, youtube: values.youtube });
}
