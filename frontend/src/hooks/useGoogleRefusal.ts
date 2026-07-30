import { useSearchParams } from 'react-router-dom';

import { GoogleAuth } from '../lib/googleAuth';

// The sentence to show for a Google round trip that came back refused (017, FR-007), or
// the page's own failure when it has one — a submit the visitor just watched fail is a
// newer event than the code still sitting in the URL.
//
// The ?error= value is a display input ONLY: it is never an auth decision, and it is
// rendered through GoogleAuth's fixed map rather than interpolated, so a hand-crafted
// /login?error=<script> produces nothing but the generic sentence. Both auth pages read
// it through here so the same code cannot grow two different sentences on two pages.
export function useGoogleRefusal(pageError = ''): string {
  const [params] = useSearchParams();
  return pageError || GoogleAuth.errorMessage(params.get('error'));
}
