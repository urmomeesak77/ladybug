import { UploadApi } from './uploadApi';
import type { UploadResult } from './uploadApi';
import type { FieldErrors } from './authApi';

export type UploadMode = 'image' | 'youtube';

export type UploadValues = { title: string; file: File | null; youtube: string };

// Pure upload decisions, converged onto one class: the client-side pre-check and the
// per-mode endpoint dispatch. The server stays authoritative for everything else
// (type/size/well-formedness, YouTube parsing).
export class UploadModel {
  // In image mode a file is required; the server validates the rest.
  static validate(mode: UploadMode, values: UploadValues): FieldErrors {
    if (mode === 'image' && values.file === null) {
      return { image: ['Choose an image to upload.'] };
    }
    return {};
  }

  // Dispatch a submission to the right endpoint for the active mode.
  static submit(mode: UploadMode, values: UploadValues): Promise<UploadResult> {
    if (mode === 'image') {
      return UploadApi.uploadImage({ title: values.title, file: values.file as File });
    }
    return UploadApi.uploadYoutube({ title: values.title, youtube: values.youtube });
  }
}
