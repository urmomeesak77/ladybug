import AuthField from './AuthField';
import type { FieldErrors } from '../lib/authApi';
import type { UploadMode } from '../lib/uploadModel';

// The mode-dependent media input for the upload form: a YouTube link field, or an
// accessible image file picker with its error association. Split out so UploadPage stays
// presentation-thin and within the function-length limit.
function UploadMediaField({ mode, youtube, errors, onFile, onYoutube }: {
  mode: UploadMode;
  youtube: string;
  errors: FieldErrors;
  onFile: (file: File | null) => void;
  onYoutube: (value: string) => void;
}) {
  if (mode === 'youtube') {
    return (
      <AuthField
        id="youtube"
        label="YouTube link"
        type="text"
        value={youtube}
        autoComplete="off"
        error={errors.youtube?.[0]}
        onChange={onYoutube}
      />
    );
  }

  if (mode === 'video') {
    return (
      <div className="auth-field">
        <label htmlFor="video">Video file</label>
        <input
          id="video"
          type="file"
          accept="video/mp4,video/webm"
          aria-invalid={errors.video ? true : undefined}
          aria-describedby={errors.video ? 'video-error' : undefined}
          onChange={(event) => onFile(event.target.files?.[0] ?? null)}
        />
        {errors.video ? (
          <span id="video-error" className="auth-field__error" role="alert">
            {errors.video[0]}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="auth-field">
      <label htmlFor="image">Image file</label>
      <input
        id="image"
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        aria-invalid={errors.image ? true : undefined}
        aria-describedby={errors.image ? 'image-error' : undefined}
        onChange={(event) => onFile(event.target.files?.[0] ?? null)}
      />
      {errors.image ? (
        <span id="image-error" className="auth-field__error" role="alert">
          {errors.image[0]}
        </span>
      ) : null}
    </div>
  );
}

export default UploadMediaField;
