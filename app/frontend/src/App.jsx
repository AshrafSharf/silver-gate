import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import AuthInitializer from './components/AuthInitializer';
import AppShell from './components/AppShell';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import ScannedItemsPage from './pages/ScannedItemsPage';
import ExtractedQuestionsPage from './pages/ExtractedQuestionsPage';
import ExtractedSolutionsPage from './pages/ExtractedSolutionsPage';
import LessonFoldersPage from './pages/LessonFoldersPage';
import LessonsPage from './pages/LessonsPage';

function ProtectedRoute({ children }) {
  const { user, isInitialized } = useAuthStore();

  if (!isInitialized) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function App() {
  return (
    <AuthInitializer>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <AppShell>
                  <Routes>
                    <Route path="/" element={<HomePage />} />
                    <Route path="/scanned-items" element={<ScannedItemsPage />} />
                    <Route path="/extracted-questions" element={<ExtractedQuestionsPage />} />
                    <Route path="/extracted-solutions" element={<ExtractedSolutionsPage />} />
                    <Route path="/lesson-folders" element={<LessonFoldersPage />} />
                    <Route path="/lessons" element={<LessonsPage />} />
                  </Routes>
                </AppShell>
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthInitializer>
  );
}

export default App;
