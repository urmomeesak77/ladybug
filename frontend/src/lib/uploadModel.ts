import { UploadApi } from './uploadApi';
import type { UploadResult } from './uploadApi';
import type { FieldErrors } from './authApi';

export type UploadMode = 'image' | 'youtube' | 'video';

export type UploadValues = { title: string; file: File | null; youtube: string };

// Pure upload decisions, converged onto one class: the client-side pre-check and the
// per-mode endpoint dispatch. The server stays authoritative for everything else
// (type/size/well-formedness, YouTube parsing).
export class UploadModel {
  // A title is always required (trimmed); in image mode a file is required too. The server
  // stays authoritative for the rest (type/size/well-formedness, YouTube parsing).
  static validate(mode: UploadMode, values: UploadValues): FieldErrors {
    const errors: FieldErrors = {};
    if (values.title.trim() === '') {
      errors.title = ['Enter a title.'];
    }
    if (mode === 'image' && values.file === null) {
      errors.image = ['Choose an image to upload.'];
    }
    if (mode === 'video' && values.file === null) {
      errors.video = ['Choose a video to upload.'];
    }
    return errors;
  }

  // Dispatch a submission to the right endpoint for the active mode.
  static submit(mode: UploadMode, values: UploadValues): Promise<UploadResult> {
    if (mode === 'image') {
      return UploadApi.uploadImage({ title: values.title, file: values.file as File });
    }
    if (mode === 'video') {
      return UploadApi.uploadVideo({ title: values.title, file: values.file as File });
    }
    return UploadApi.uploadYoutube({ title: values.title, youtube: values.youtube });
  }
}
