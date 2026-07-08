import { BrowserRouter, Route, Routes } from 'react-router-dom';

import AuthProvider from './components/AuthProvider';
import NoticeProvider from './components/NoticeProvider';
import PageLayout from './components/PageLayout';
import RequireAnon from './components/RequireAnon';
import RequireAuth from './components/RequireAuth';
import { useTheme } from './hooks/useTheme';
import AccountPage from './pages/AccountPage';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
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
              <Route path="/upload" element={<RequireAuth><UploadPage /></RequireAuth>} />
              <Route path="/verify-email" element={<RequireAuth><VerifyEmailNoticePage /></RequireAuth>} />
              <Route path="/verify-email/:hash" element={<RequireAuth><VerifyEmailPage /></RequireAuth>} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </PageLayout>
        </NoticeProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
