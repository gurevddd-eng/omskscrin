import type { KioskDto } from "@stella/shared";

export type OtaUiState = "current" | "outdated" | "pending" | "unknown" | "no-package";

export function resolveOtaState(
  local: string | null | undefined,
  target: string | null | undefined,
  pending?: boolean
): OtaUiState {
  const sw = String(local || "").trim() || null;
  const tg = String(target || "").trim() || null;
  if (!tg) return "no-package";
  if (pending && sw !== tg) return "pending";
  if (!sw) return "unknown";
  if (sw === tg) return "current";
  return "outdated";
}

export function otaStateLabel(state: OtaUiState): string {
  switch (state) {
    case "current":
      return "Актуальна";
    case "outdated":
      return "Нужно обновить";
    case "pending":
      return "Обновляется…";
    case "unknown":
      return "Версия неизвестна";
    case "no-package":
      return "Нет пакета на сервере";
  }
}

type Props = {
  kiosk: KioskDto;
  /** Fallback when DTO otaTarget missing (older server). */
  deployTarget?: string | null;
  updating?: boolean;
};

export function KioskOtaStatus({ kiosk, deployTarget, updating }: Props) {
  const local = kiosk.softwareVersion || null;
  const target = kiosk.otaTarget || deployTarget || null;
  const pending = Boolean(updating || kiosk.otaPending);
  const state = resolveOtaState(local, target, pending);

  return (
    <section className={`kx-ota kx-ota--${state}`} aria-live="polite">
      <div className="kx-ota__head">
        <h3 className="kx-ota__title">Версия ПО (OTA)</h3>
        <span className={`kx-ota__badge kx-ota__badge--${state}`}>{otaStateLabel(state)}</span>
      </div>

      <div className="kx-ota__grid">
        <div className="kx-ota__cell">
          <span className="kx-ota__label">На киоске</span>
          <span className="kx-ota__value mono">{local || "—"}</span>
        </div>
        <div className="kx-ota__arrow" aria-hidden>
          →
        </div>
        <div className="kx-ota__cell">
          <span className="kx-ota__label">Пакет на сервере</span>
          <span className="kx-ota__value mono">{target || "—"}</span>
        </div>
      </div>

      {state === "pending" ? (
        <p className="kx-ota__msg">
          <span className="kx-task__spin" aria-hidden />
          Сигнал отправлен. Агент применяет пакет и сразу шлёт heartbeat (обычно 10–30 с).
        </p>
      ) : null}
      {state === "outdated" ? (
        <p className="kx-ota__msg">
          Киоск на старой сборке. Нажмите «Обновить ПО» — статус сменится на «Обновляется…», затем на
          «Актуальна».
        </p>
      ) : null}
      {state === "current" ? (
        <p className="kx-ota__msg kx-ota__msg--ok">Киоск совпадает с пакетом на сервере.</p>
      ) : null}
      {state === "unknown" ? (
        <p className="kx-ota__msg">Агент ещё не сообщил softwareVersion (нет heartbeat / не установлен).</p>
      ) : null}
    </section>
  );
}

export function otaListTagClass(state: OtaUiState): string {
  if (state === "current") return "is-live";
  if (state === "pending") return "is-busy";
  if (state === "outdated" || state === "unknown") return "is-bad";
  return "";
}

export function otaListTagText(state: OtaUiState, local: string | null): string {
  if (state === "pending") return "OTA…";
  if (state === "current") return local || "OK";
  if (state === "outdated") return local ? `${local} ↑` : "OTA ↑";
  if (state === "unknown") return "OTA ?";
  return local || "—";
}
