import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { FieldErrors } from '../lib/authApi';
import type { UploadMode } from '../lib/uploadModel';
import { UploadModel } from '../lib/uploadModel';

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

  // Switch the active media tab and drop the departed input's stale field error, so an error
  // raised against (say) the image field cannot linger once the YouTube tab hides that input.
  function changeMode(next: UploadMode): void {
    setMode(next);
    const departed = next === 'image' ? 'youtube' : 'image';
    if (errors[departed]) {
      const remaining = { ...errors };
      delete remaining[departed];
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
