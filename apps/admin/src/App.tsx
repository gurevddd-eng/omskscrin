import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth";
import { ConfirmProvider } from "./components/ui/confirm";
import { ContentLayout } from "./components/layout/ContentLayout";
import { SystemLayout } from "./components/layout/SystemLayout";
import { AppLayout } from "./components/layout/AppLayout";
import { DashboardPage } from "./pages/DashboardPage";
import { AdsPage } from "./pages/AdsPage";
import { TimelineAdminPage } from "./pages/TimelineAdminPage";
import { ExhibitsPage } from "./pages/ExhibitsPage";
import { ExhibitPreviewPage } from "./pages/ExhibitPreviewPage";
import { KiosksPage } from "./pages/KiosksPage";
import { LoginPage } from "./pages/LoginPage";
import { SettingsPage } from "./pages/SettingsPage";
import { UsersPage } from "./pages/UsersPage";

export function App() {
  return (
    <AuthProvider>
      <ConfirmProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/exhibits/:id/preview" element={<ExhibitPreviewPage />} />
            <Route element={<AppLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="content" element={<ContentLayout />}>
                <Route path="exhibits" element={<ExhibitsPage />} />
                <Route path="timeline" element={<TimelineAdminPage />} />
                <Route path="ads" element={<AdsPage />} />
              </Route>
              <Route path="kiosks" element={<KiosksPage />} />
              <Route path="system" element={<SystemLayout />}>
                <Route index element={<Navigate to="settings" replace />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="users" element={<UsersPage />} />
              </Route>
              {/* Legacy paths */}
              <Route path="monitor" element={<Navigate to="/" replace />} />
              <Route path="exhibits" element={<Navigate to="/content/exhibits" replace />} />
              <Route path="timeline" element={<Navigate to="/content/timeline" replace />} />
              <Route path="ads" element={<Navigate to="/content/ads" replace />} />
              <Route path="settings" element={<Navigate to="/system/settings" replace />} />
              <Route path="users" element={<Navigate to="/system/users" replace />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ConfirmProvider>
    </AuthProvider>
  );
}
