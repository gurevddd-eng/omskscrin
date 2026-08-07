import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth";
import { ConfirmProvider } from "./components/ui/confirm";
import { DashboardPage } from "./pages/DashboardPage";
import { AdsPage } from "./pages/AdsPage";
import { TimelineAdminPage } from "./pages/TimelineAdminPage";
import { AppLayout } from "./components/layout/AppLayout";
import { ExhibitsPage } from "./pages/ExhibitsPage";
import { KiosksPage } from "./pages/KiosksPage";
import { LoginPage } from "./pages/LoginPage";
import { MonitoringPage } from "./pages/MonitoringPage";
import { SettingsPage } from "./pages/SettingsPage";
import { UsersPage } from "./pages/UsersPage";

export function App() {
  return (
    <AuthProvider>
      <ConfirmProvider>
        <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<AppLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="monitor" element={<MonitoringPage />} />
            <Route path="exhibits" element={<ExhibitsPage />} />
            <Route path="timeline" element={<TimelineAdminPage />} />
            <Route path="ads" element={<AdsPage />} />
            <Route path="kiosks" element={<KiosksPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="users" element={<UsersPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      </ConfirmProvider>
    </AuthProvider>
  );
}
