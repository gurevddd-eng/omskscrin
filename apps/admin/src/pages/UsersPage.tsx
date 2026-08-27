import { FormEvent, useEffect, useMemo, useState } from "react";
import type { AuthUser, Role } from "@stella/shared";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth";
import { api } from "../api";
import { PageShell } from "../components/ui/PageShell";
import { Alert } from "../components/ui/Alert";
import { useConfirm } from "../components/ui/confirm";

const ROLE_HINT: Record<Role, string> = {
  admin: "Полный доступ",
  editor: "Контент и киоски",
  viewer: "Только просмотр",
};

function initials(login: string) {
  const clean = login.trim();
  if (!clean) return "?";
  const parts = clean.split(/[.\-_@\s]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return clean.slice(0, 2).toUpperCase();
}

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
  const [createBusy, setCreateBusy] = useState(false);
  const [filter, setFilter] = useState("");

  const stats = useMemo(() => {
    const active = users.filter((u) => u.active).length;
    const admins = users.filter((u) => u.role === "admin" || u.superAdmin).length;
    return { total: users.length, active, admins, disabled: users.length - active };
  }, [users]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) => u.login.toLowerCase().includes(q) || u.role.toLowerCase().includes(q)
    );
  }, [users, filter]);

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
    setCreateBusy(true);
    setError("");
    setSavedHint("");
    try {
      await api("/api/users", { method: "POST", json: { login, password, role } });
      setLogin("");
      setPassword("");
      setRole("editor");
      setSavedHint("Пользователь создан");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setCreateBusy(false);
    }
  }

  async function setUserRole(id: string, next: Role) {
    setError("");
    try {
      await api(`/api/users/${id}`, { method: "PATCH", json: { role: next } });
      setSavedHint("Роль обновлена");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сменить роль");
    }
  }

  async function toggleActive(u: AuthUser) {
    setError("");
    try {
      await api(`/api/users/${u.id}`, { method: "PATCH", json: { active: !u.active } });
      setSavedHint(u.active ? `«${u.login}» отключён` : `«${u.login}» включён`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    }
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
      setSavedHint("Пользователь удалён");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    }
  }

  function openPasswordEdit(u: AuthUser) {
    setPasswordEditId((id) => (id === u.id ? null : u.id));
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
      <div className="admin-toolbar">
        <ul className="admin-toolbar__stats">
          <li>
            <strong>{String(stats.total).padStart(2, "0")}</strong>
            <span>всего</span>
          </li>
          <li>
            <strong className="is-ok">{String(stats.active).padStart(2, "0")}</strong>
            <span>активны</span>
          </li>
          <li>
            <strong>{String(stats.admins).padStart(2, "0")}</strong>
            <span>админы</span>
          </li>
          <li>
            <strong className={stats.disabled ? "is-warn" : ""}>
              {String(stats.disabled).padStart(2, "0")}
            </strong>
            <span>отключены</span>
          </li>
        </ul>
        <label className="admin-toolbar__search">
          <span className="sr-only">Поиск</span>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Поиск по логину или роли"
          />
        </label>
      </div>

      <section className="users-create">
        <header className="users-create__head">
          <div>
            <h2 className="users-create__title">Новый пользователь</h2>
            <p className="users-create__hint">Логин, пароль и роль — доступ сразу после создания.</p>
          </div>
        </header>
        <form className="users-create__form" onSubmit={onCreate}>
          <label>
            Логин
            <input required value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="off" />
          </label>
          <label>
            Пароль
            <input
              required
              type="password"
              minLength={4}
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
          <button className="btn" disabled={createBusy}>
            {createBusy ? "Создание…" : "Создать"}
          </button>
        </form>
      </section>

      {filtered.length === 0 ? (
        <div className="admin-empty">
          <p className="admin-empty__title">{users.length ? "Никого не найдено" : "Пользователей нет"}</p>
          <p className="admin-empty__text">
            {users.length ? "Измените поисковый запрос." : "Создайте первую учётную запись выше."}
          </p>
        </div>
      ) : (
        <div className="users-grid">
          {filtered.map((u) => {
            const self = u.id === me?.id;
            const editingPwd = passwordEditId === u.id;
            return (
              <article key={u.id} className={`user-card${!u.active ? " is-disabled" : ""}`}>
                <header className="user-card__head">
                  <span className="user-card__avatar" aria-hidden>
                    {initials(u.login)}
                  </span>
                  <div className="user-card__who">
                    <p className="user-card__login">
                      {u.login}
                      {self ? <span className="user-card__you">вы</span> : null}
                    </p>
                    <div className="user-card__tags">
                      <span className={`badge ${u.active ? "ok" : "offline"}`}>
                        {u.active ? "активен" : "отключён"}
                      </span>
                      {u.superAdmin ? <span className="badge ok">супер-админ</span> : null}
                      <span className={`user-card__role user-card__role--${u.role}`}>{u.role}</span>
                    </div>
                  </div>
                </header>

                <label className="user-card__role-field">
                  <span>Роль</span>
                  <select
                    value={u.role}
                    disabled={u.superAdmin}
                    onChange={(e) => void setUserRole(u.id, e.target.value as Role)}
                  >
                    <option value="admin">admin — {ROLE_HINT.admin}</option>
                    <option value="editor">editor — {ROLE_HINT.editor}</option>
                    <option value="viewer">viewer — {ROLE_HINT.viewer}</option>
                  </select>
                </label>

                <div className="user-card__actions">
                  {isSuperAdmin ? (
                    <button type="button" className="btn ghost" onClick={() => openPasswordEdit(u)}>
                      {editingPwd ? "Отмена" : "Пароль"}
                    </button>
                  ) : null}
                  <button type="button" className="btn secondary" onClick={() => void toggleActive(u)}>
                    {u.active ? "Отключить" : "Включить"}
                  </button>
                  <button
                    type="button"
                    className="btn danger"
                    onClick={() => void remove(u.id)}
                    disabled={self}
                    title={self ? "Нельзя удалить себя" : undefined}
                  >
                    Удалить
                  </button>
                </div>

                {isSuperAdmin && editingPwd ? (
                  <form className="user-card__pwd" onSubmit={(e) => savePassword(e, u.id, u.login)}>
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
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
