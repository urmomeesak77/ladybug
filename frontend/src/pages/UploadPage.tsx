import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import AuthField from '../components/AuthField';
import type { FieldErrors } from '../lib/authApi';
import { uploadImage, uploadYoutube } from '../lib/uploadApi';

type Mode = 'image' | 'youtube';

// Authenticated upload form: a meme is either an image file or a YouTube link, plus an
// optional title. The mode toggle keeps exactly one input active so the "either/or" server
// rule cannot be violated from the UI. On success we go to the new permalink.
function UploadPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('image');
  const [title, setTitle] = useState('');
  const [youtube, setYoutube] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (mode === 'image' && file === null) {
      setErrors({ image: ['Choose an image to upload.'] });
      return;
    }
    setErrors({});
    setFormError('');
    setSubmitting(true);
    const result = mode === 'image'
      ? await uploadImage({ title, file: file as File })
      : await uploadYoutube({ title, youtube });
    setSubmitting(false);

    if (result.ok) {
      navigate(`/posts/${result.hash}`);
      return;
    }
    if (result.kind === 'validation') {
      setErrors(result.errors);
      return;
    }
    if (result.kind === 'auth') {
      setFormError('Please log in again to post.');
      return;
    }
    setFormError('Something went wrong. Please try again.');
  }

  return (
    <section className="upload">
      <h1>Upload a meme</h1>
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        {formError ? <p className="auth-form__error" role="alert">{formError}</p> : null}

        <fieldset className="upload__mode">
          <legend>What are you posting?</legend>
          <label>
            <input type="radio" name="mode" checked={mode === 'image'} onChange={() => setMode('image')} />
            Image
          </label>
          <label>
            <input type="radio" name="mode" checked={mode === 'youtube'} onChange={() => setMode('youtube')} />
            YouTube
          </label>
        </fieldset>

        <AuthField id="title" label="Title (optional)" type="text" value={title} autoComplete="off" error={errors.title?.[0]} onChange={setTitle} />

        {mode === 'image' ? (
          <div className="auth-field">
            <label htmlFor="image">Image file</label>
            <input
              id="image"
              type="file"
              accept="image/jpeg,image/png,image/gif"
              aria-invalid={errors.image ? true : undefined}
              aria-describedby={errors.image ? 'image-error' : undefined}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            {errors.image ? <span id="image-error" className="auth-field__error" role="alert">{errors.image[0]}</span> : null}
          </div>
        ) : (
          <AuthField id="youtube" label="YouTube link" type="text" value={youtube} autoComplete="off" error={errors.youtube?.[0]} onChange={setYoutube} />
        )}

        <button type="submit" disabled={submitting}>
          {submitting ? 'Posting…' : 'Post'}
        </button>
      </form>
    </section>
  );
}

export default UploadPage;
