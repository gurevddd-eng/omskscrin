import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth";

export function LoginPage() {
  const { user, login, loading } = useAuth();
  const [loginName, setLoginName] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (loading) {
    return (
      <div className="cx-loading cx-loading--full">
        <span className="cx-loading__spin" aria-hidden />
        Загрузка…
      </div>
    );
  }
  if (user) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(loginName, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка входа");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cx-login">
      <div className="cx-login__panel cx-login__panel--brand">
        <p className="cx-login__eyebrow">Омскэкран · информационные киоски</p>
        <h1 className="cx-login__title">Админка Омскэкран</h1>
        <p className="cx-login__lead">
          Debian-сервер, Windows-киоски, контент и lockdown — единая точка управления.
        </p>
        <ul className="cx-login__list">
          <li>Быстрый доступ ко всем разделам</li>
          <li>Экспонаты и реклама</li>
          <li>Удалённая установка и конфиг</li>
        </ul>
      </div>
      <div className="cx-login__panel">
        <form className="cx-login__form stack" onSubmit={onSubmit}>
          <h2>Вход</h2>
          <p className="muted">Учётная запись админки</p>
          <label>
            Логин
            <input
              value={loginName}
              onChange={(e) => setLoginName(e.target.value)}
              autoComplete="username"
            />
          </label>
          <label>
            Пароль
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          {error ? <div className="cx-alert cx-alert--error cx-alert--inline">{error}</div> : null}
          <button className="btn" disabled={busy}>
            {busy ? "Вход…" : "Войти"}
          </button>
        </form>
      </div>
    </div>
  );
}
