import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { FieldErrors } from '../lib/authApi';
import type { UploadMode } from '../lib/uploadModel';
import { submitUpload, validateUpload } from '../lib/uploadModel';

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

  async function submit(): Promise<void> {
    const clientErrors = validateUpload(mode, { title, file, youtube });
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      return;
    }
    setErrors({});
    setFormError('');
    setSubmitting(true);
    const result = await submitUpload(mode, { title, file, youtube });
    setSubmitting(false);

    if (result.ok) {
      navigate(`/posts/${result.hash}`);
      return;
    }
    if (result.kind === 'validation') {
      setErrors(result.errors);
      return;
    }
    setFormError(result.kind === 'auth' ? 'Please log in again to post.' : 'Something went wrong. Please try again.');
  }

  return { mode, setMode, title, setTitle, youtube, setYoutube, setFile, errors, formError, submitting, submit };
}
