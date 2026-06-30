import type { FormEvent } from 'react';

import AuthField from '../components/AuthField';
import UploadMediaField from '../components/UploadMediaField';
import { useUploadForm } from '../hooks/useUploadForm';

// Authenticated upload form: a meme is either an image file or a YouTube link, plus an
// optional title. The mode toggle keeps exactly one input active so the "either/or" server
// rule cannot be violated from the UI. State + submit live in useUploadForm.
function UploadPage() {
  const {
    mode, setMode, title, setTitle, youtube, setYoutube,
    setFile, errors, formError, submitting, submit,
  } = useUploadForm();

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submit();
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

        <AuthField
          id="title"
          label="Title (optional)"
          type="text"
          value={title}
          autoComplete="off"
          error={errors.title?.[0]}
          onChange={setTitle}
        />
        <UploadMediaField mode={mode} youtube={youtube} errors={errors} onFile={setFile} onYoutube={setYoutube} />

        <button type="submit" disabled={submitting}>
          {submitting ? 'Posting…' : 'Post'}
        </button>
      </form>
    </section>
  );
}

export default UploadPage;
