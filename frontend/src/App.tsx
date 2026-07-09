import { BrowserRouter, Route, Routes } from 'react-router-dom';

import AuthProvider from './components/AuthProvider';
import NoticeProvider from './components/NoticeProvider';
import PageLayout from './components/PageLayout';
import RequireAnon from './components/RequireAnon';
import RequireAuth from './components/RequireAuth';
import RequireRole from './components/RequireRole';
import RequireVerified from './components/RequireVerified';
import { useTheme } from './hooks/useTheme';
import AccountPage from './pages/AccountPage';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import ModerationPage from './pages/ModerationPage';
import NotFoundPage from './pages/NotFoundPage';
import PostPage from './pages/PostPage';
import RegisterPage from './pages/RegisterPage';
import UploadPage from './pages/UploadPage';
import VerifyEmailNoticePage from './pages/VerifyEmailNoticePage';
import VerifyEmailPage from './pages/VerifyEmailPage';

function App() {
  useTheme();

  return (
    <BrowserRouter>
      <AuthProvider>
        <NoticeProvider>
          <PageLayout>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/posts/:hash" element={<PostPage />} />
              <Route path="/login" element={<RequireAnon><LoginPage /></RequireAnon>} />
              <Route path="/register" element={<RequireAnon><RegisterPage /></RequireAnon>} />
              <Route path="/account" element={<RequireAuth><AccountPage /></RequireAuth>} />
              {/* Admin moderation console (010). The server gates the data (role:admin);
                  RequireRole mirrors that boundary in the SPA, keeping the page (and its
                  nav link) admin-or-higher only. */}
              <Route
                path="/admin/trashposts"
                element={<RequireRole role="admin"><ModerationPage /></RequireRole>}
              />
              <Route path="/upload" element={<RequireAuth><RequireVerified><UploadPage /></RequireVerified></RequireAuth>} />
              <Route path="/verify-email" element={<RequireAuth><VerifyEmailNoticePage /></RequireAuth>} />
              {/* Deliberately unguarded: the emailed link must verify even in a
                  logged-out browser — the signed URL itself proves inbox control. */}
              <Route path="/verify-email/:hash" element={<VerifyEmailPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </PageLayout>
        </NoticeProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
