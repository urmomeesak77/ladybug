import { BrowserRouter, Route, Routes } from 'react-router-dom';

import PageLayout from './components/PageLayout';
import HomePage from './pages/HomePage';
import NotFoundPage from './pages/NotFoundPage';
import PostPlaceholderPage from './pages/PostPlaceholderPage';

function App() {
  return (
    <BrowserRouter>
      <PageLayout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/posts/:hash" element={<PostPlaceholderPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </PageLayout>
    </BrowserRouter>
  );
}

export default App;
