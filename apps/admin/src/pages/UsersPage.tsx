import { FormEvent, Fragment, useEffect, useState } from "react";
import type { AuthUser, Role } from "@stella/shared";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth";
import { api } from "../api";
import { PageShell } from "../components/ui/PageShell";
import { Alert } from "../components/ui/Alert";
import { Card } from "../components/ui/Card";
import { useConfirm } from "../components/ui/confirm";

const ROLE_HINT: Record<Role, string> = {
  admin: "Полный доступ",
  editor: "Контент и киоски",
  viewer: "Только просмотр",
};

export function UsersPage() {
  const { isAdmin, isSuperAdmin, user: me } = useAuth();
  const confirmDialog = useConfirm();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [error, setError] = useState("");
  const [savedHint, setSavedHint] = useState("");
  const [passwordEditId, setPasswordEditId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);

  async function load() {
    setUsers(await api<AuthUser[]>("/api/users"));
  }

  useEffect(() => {
    if (!isAdmin) return;
    load().catch((e) => setError(e.message));
  }, [isAdmin]);

  if (!isAdmin) return <Navigate to="/" replace />;

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    try {
      await api("/api/users", { method: "POST", json: { login, password, role } });
      setLogin("");
      setPassword("");
      setRole("editor");
      setSavedHint("Пользователь создан");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    }
  }

  async function setUserRole(id: string, next: Role) {
    await api(`/api/users/${id}`, { method: "PATCH", json: { role: next } });
    await load();
  }

  async function toggleActive(u: AuthUser) {
    await api(`/api/users/${u.id}`, { method: "PATCH", json: { active: !u.active } });
    await load();
  }

  async function remove(id: string) {
    const u = users.find((x) => x.id === id);
    const ok = await confirmDialog({
      title: "Удалить пользователя?",
      message: u ? `Учётная запись «${u.login}» будет удалена без возможности восстановления.` : undefined,
      confirmLabel: "Удалить",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api(`/api/users/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    }
  }

  function openPasswordEdit(u: AuthUser) {
    setPasswordEditId(u.id);
    setNewPassword("");
    setError("");
    setSavedHint("");
  }

  function closePasswordEdit() {
    setPasswordEditId(null);
    setNewPassword("");
    setPasswordBusy(false);
  }

  async function savePassword(e: FormEvent, userId: string, loginName: string) {
    e.preventDefault();
    if (newPassword.length < 4) {
      setError("Пароль — минимум 4 символа");
      return;
    }
    const self = userId === me?.id;
    const ok = await confirmDialog({
      title: self ? "Сменить ваш пароль?" : "Сменить пароль?",
      message: self
        ? "Новый пароль будет сохранён для вашей учётной записи."
        : `Новый пароль будет сохранён для «${loginName}».`,
      details: self ? "Текущая сессия останется активной." : undefined,
      confirmLabel: "Сохранить пароль",
      tone: "warn",
    });
    if (!ok) return;
    setPasswordBusy(true);
    setError("");
    try {
      await api(`/api/users/${userId}`, { method: "PATCH", json: { password: newPassword } });
      setSavedHint(self ? "Ваш пароль обновлён" : `Пароль «${loginName}» обновлён`);
      closePasswordEdit();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сменить пароль");
    } finally {
      setPasswordBusy(false);
    }
  }

  return (
    <PageShell
      section="Система"
      title="Пользователи"
      description={
        isSuperAdmin
          ? "Учётные записи админки. Супер-админ может сбрасывать пароли другим пользователям."
          : "Учётные записи для входа в админку. Роли определяют, кто может менять контент и киоски."
      }
      banner={
        <>
          {error ? <Alert tone="error">{error}</Alert> : null}
          {savedHint ? <Alert tone="success">{savedHint}</Alert> : null}
        </>
      }
    >
      <Card title="Новый пользователь">
        <form className="form-row" onSubmit={onCreate}>
          <label>
            Логин
            <input required value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="off" />
          </label>
          <label>
            Пароль
            <input
              required
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label>
            Роль
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="admin">admin — {ROLE_HINT.admin}</option>
              <option value="editor">editor — {ROLE_HINT.editor}</option>
              <option value="viewer">viewer — {ROLE_HINT.viewer}</option>
            </select>
          </label>
          <button className="btn">Создать</button>
        </form>
      </Card>

      <Card title={`Активные · ${users.length}`} padding="none">
        <div className="cx-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Логин</th>
                <th>Роль</th>
                <th>Статус</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <Fragment key={u.id}>
                  <tr>
                    <td className="cx-cell-title">
                      {u.login}
                      {u.superAdmin ? (
                        <span className="badge ok" style={{ marginLeft: "0.5rem" }}>
                          супер-админ
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <select value={u.role} onChange={(e) => setUserRole(u.id, e.target.value as Role)}>
                        <option value="admin">admin</option>
                        <option value="editor">editor</option>
                        <option value="viewer">viewer</option>
                      </select>
                      <div className="muted cx-cell-sub">{ROLE_HINT[u.role]}</div>
                    </td>
                    <td>
                      <span className={`badge ${u.active ? "ok" : "offline"}`}>
                        {u.active ? "активен" : "отключён"}
                      </span>
                    </td>
                    <td>
                      <div className="row" style={{ justifyContent: "flex-end", flexWrap: "wrap" }}>
                        {isSuperAdmin ? (
                          <button type="button" className="btn ghost" onClick={() => openPasswordEdit(u)}>
                            {passwordEditId === u.id ? "Отмена" : "Пароль"}
                          </button>
                        ) : null}
                        <button type="button" className="btn secondary" onClick={() => toggleActive(u)}>
                          {u.active ? "Отключить" : "Включить"}
                        </button>
                        <button
                          type="button"
                          className="btn danger"
                          onClick={() => remove(u.id)}
                          disabled={u.id === me?.id}
                        >
                          Удалить
                        </button>
                      </div>
                    </td>
                  </tr>
                  {isSuperAdmin && passwordEditId === u.id ? (
                    <tr key={`${u.id}-pwd`} className="users-password-row">
                      <td colSpan={4}>
                        <form className="users-password-form" onSubmit={(e) => savePassword(e, u.id, u.login)}>
                          <label>
                            Новый пароль для «{u.login}»
                            <input
                              required
                              type="password"
                              minLength={4}
                              value={newPassword}
                              onChange={(e) => setNewPassword(e.target.value)}
                              autoComplete="new-password"
                              autoFocus
                            />
                          </label>
                          <button type="submit" className="btn" disabled={passwordBusy}>
                            {passwordBusy ? "Сохранение…" : "Сохранить пароль"}
                          </button>
                        </form>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </PageShell>
  );
}
