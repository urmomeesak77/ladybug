import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { FieldErrors } from '../lib/authApi';
import type { UploadMode } from '../lib/uploadModel';
import { UploadModel } from '../lib/uploadModel';

const ALL_MODES: UploadMode[] = ['image', 'youtube', 'video'];

// State + submit flow for the upload form. Keeps UploadPage to presentation only. The pure
// decisions (validation, endpoint dispatch) live in lib/uploadModel; this is the React glue.
export function useUploadForm() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<UploadMode>('image');
  const [title, setTitle] = useState('');
  const [youtube, setYoutube] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Switch the active media tab and drop every departed input's stale field error, so an
  // error raised against (say) the image field cannot linger once a different tab hides
  // that input — field names already equal mode names, so this is just "every mode but
  // the one we're switching to."
  function changeMode(next: UploadMode): void {
    setMode(next);
    const departed = ALL_MODES.filter((candidate) => candidate !== next);
    if (departed.some((field) => errors[field])) {
      const remaining = { ...errors };
      departed.forEach((field) => delete remaining[field]);
      setErrors(remaining);
    }
  }

  async function submit(): Promise<void> {
    const clientErrors = UploadModel.validate(mode, { title, file, youtube });
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      return;
    }
    setErrors({});
    setFormError('');
    setSubmitting(true);
    const result = await UploadModel.submit(mode, { title, file, youtube });
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
    if (result.kind === 'unverified') {
      setFormError('Verify your e-mail address before posting.');
      return;
    }
    setFormError('Something went wrong. Please try again.');
  }

  return { mode, setMode: changeMode, title, setTitle, youtube, setYoutube, setFile, errors, formError, submitting, submit };
}
