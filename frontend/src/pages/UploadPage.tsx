import type { FormEvent } from 'react';

import AuthField from '../components/AuthField';
import BusyButton from '../components/BusyButton';
import MediaTabs from '../components/MediaTabs';
import UploadMediaField from '../components/UploadMediaField';
import { useUploadForm } from '../hooks/useUploadForm';

// Authenticated upload form: a meme is either an image file or a YouTube link, plus a
// required title. The Image/YouTube tabs keep exactly one input active so the "either/or"
// server rule cannot be violated from the UI. State + submit live in useUploadForm.
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
    <section className="auth">
      <h1>Upload</h1>
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        {formError ? <p className="auth-form__error" role="alert">{formError}</p> : null}

        {/* Disabling this wrapper (not just the button) makes the in-flight state
            visually detectable across the whole form while the request runs. */}
        <fieldset disabled={submitting}>
          <AuthField
            id="title"
            label="Title"
            type="text"
            value={title}
            autoComplete="off"
            error={errors.title?.[0]}
            onChange={setTitle}
          />
          <MediaTabs selected={mode} onSelect={setMode}>
            <UploadMediaField mode={mode} youtube={youtube} errors={errors} onFile={setFile} onYoutube={setYoutube} />
          </MediaTabs>

          <BusyButton type="submit" busy={submitting}>
            {submitting ? 'Posting…' : 'Post'}
          </BusyButton>
        </fieldset>
      </form>
    </section>
  );
}

export default UploadPage;
