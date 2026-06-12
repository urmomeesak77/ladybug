import { BrowserRouter, Route, Routes } from 'react-router-dom';

import PageLayout from './components/PageLayout';
import { useTheme } from './hooks/useTheme';
import HomePage from './pages/HomePage';
import NotFoundPage from './pages/NotFoundPage';
import PostPage from './pages/PostPage';

function App() {
  useTheme();

  return (
    <BrowserRouter>
      <PageLayout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/posts/:hash" element={<PostPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </PageLayout>
    </BrowserRouter>
  );
}

export default App;
