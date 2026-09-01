import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth";

export function ExhibitPreviewPage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="cx-loading">
        <span className="cx-loading__spin" aria-hidden />
        Загрузка…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!id) return <Navigate to="/content/exhibits" replace />;

  return (
    <div className="kiosk-preview-shell">
      <header className="kiosk-preview-shell__bar">
        <button type="button" className="btn secondary" onClick={() => navigate("/content/exhibits")}>
          Закрыть
        </button>
        <p className="kiosk-preview-shell__note">
          Превью как на киоске — сохранённая версия экспоната, баннеры, хроника и тема
        </p>
      </header>
      <iframe
        className="kiosk-preview-shell__frame"
        title="Превью киоска"
        src={`/kiosk-preview.html?id=${encodeURIComponent(id)}`}
      />
    </div>
  );
}
