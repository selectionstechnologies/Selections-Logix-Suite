import { Suspense, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from './components/layout/AppLayout.jsx';
import { ConfirmHost, PageSkeleton, ToastHost } from './components/ui/index.jsx';
import { ErrorBoundary, Forbidden, NotFound } from './components/layout/Fallbacks.jsx';
import { Guard, RequireAuth, routeTable, LoginPage, TrackPage } from './routes/index.jsx';
import { useUI } from './store/uiStore.js';

export default function App() {
  const lang = useUI((s) => s.lang);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ur' ? 'rtl' : 'ltr';
  }, [lang]);

  return (
    <ErrorBoundary>
      <Suspense fallback={<div className="p-6"><PageSkeleton /></div>}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/track" element={<TrackPage />} />
          <Route path="/track/:awb" element={<TrackPage />} />
          <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
            {routeTable.map(({ path, element: Page, module, roles }) => (
              <Route key={path} path={path} element={<Guard module={module} roles={roles}><Page /></Guard>} />
            ))}
            <Route path="/403" element={<Forbidden />} />
            <Route path="/home" element={<Navigate to="/" replace />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Suspense>
      <ToastHost />
      <ConfirmHost />
    </ErrorBoundary>
  );
}
