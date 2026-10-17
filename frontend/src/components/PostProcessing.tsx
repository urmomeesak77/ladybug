import { Link } from 'react-router-dom';

// What the uploader (or an admin) sees on a permalink whose media is not ready yet (024,
// contracts/ui-processing-state.md). The words carry the meaning; the spinner is decoration
// and is hidden from assistive technology (Principle IV).
function PostProcessing({ state }: { state: 'processing' | 'failed' }) {
  if (state === 'failed') {
    return (
      <div className="post-processing post-processing--failed" role="alert">
        <p>We couldn&apos;t process this upload.</p>
        <p><Link to="/upload">Upload it again</Link></p>
      </div>
    );
  }
  return (
    <div className="post-processing" role="status">
      <span className="post-processing__spinner" aria-hidden="true" />
      <p>Your upload is being processed. This page will update by itself.</p>
    </div>
  );
}

export default PostProcessing;
