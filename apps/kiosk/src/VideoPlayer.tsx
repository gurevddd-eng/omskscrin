import { useCallback, useEffect, useRef, useState } from "react";

function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type Props = {
  src: string;
  active: boolean;
  title?: string;
};

export function VideoPlayer({ src, active, title }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.85);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seeking, setSeeking] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekValue = useRef(0);

  const bumpControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setControlsVisible(false);
    }, 3200);
  }, []);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.volume = volume;
    el.muted = muted;
  }, [volume, muted]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.pause();
    el.currentTime = 0;
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
    setControlsVisible(true);
  }, [src]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    if (!active) {
      el.pause();
      setPlaying(false);
      setControlsVisible(true);
      return;
    }

    let cancelled = false;
    const tryPlay = () => {
      if (cancelled) return;
      void el
        .play()
        .then(() => {
          if (!cancelled) {
            setPlaying(true);
            bumpControls();
          }
        })
        .catch(() => {
          if (!cancelled) setPlaying(false);
        });
    };

    if (el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      tryPlay();
    } else {
      const onReady = () => tryPlay();
      el.addEventListener("canplay", onReady);
      el.load();
      return () => {
        cancelled = true;
        el.removeEventListener("canplay", onReady);
      };
    }

    return () => {
      cancelled = true;
    };
  }, [active, src, bumpControls]);

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    bumpControls();
    if (el.paused) {
      void el
        .play()
        .then(() => setPlaying(true))
        .catch(() => setPlaying(false));
    } else {
      el.pause();
      setPlaying(false);
      setControlsVisible(true);
    }
  }, [bumpControls]);

  const seekBy = useCallback(
    (delta: number) => {
      const el = videoRef.current;
      if (!el || !duration) return;
      const next = Math.min(Math.max(0, el.currentTime + delta), duration);
      try {
        el.currentTime = next;
      } catch {
        /* ignore seek errors while buffering */
      }
      setCurrent(next);
      bumpControls();
    },
    [bumpControls, duration]
  );

  function onTimeUpdate() {
    const el = videoRef.current;
    if (!el || seeking) return;
    setCurrent(el.currentTime);
  }

  function onLoadedMeta() {
    const el = videoRef.current;
    if (!el) return;
    const d = el.duration;
    setDuration(Number.isFinite(d) ? d : 0);
  }

  function onDurationChange() {
    const el = videoRef.current;
    if (!el) return;
    const d = el.duration;
    if (Number.isFinite(d) && d > 0) setDuration(d);
  }

  function onSeekInput(value: number) {
    seekValue.current = value;
    setCurrent(value);
    setSeeking(true);
    bumpControls();
  }

  function onSeekCommit(value: number) {
    const el = videoRef.current;
    const next = Number.isFinite(value) ? value : seekValue.current;
    if (el && Number.isFinite(next)) {
      try {
        el.currentTime = next;
      } catch {
        /* Range not ready yet */
      }
    }
    setCurrent(next);
    setSeeking(false);
    bumpControls();
  }

  function onVolumeInput(value: number) {
    setVolume(value);
    if (value > 0 && muted) setMuted(false);
    if (value === 0) setMuted(true);
    bumpControls();
  }

  function toggleMute() {
    setMuted((m) => {
      if (m && volume === 0) setVolume(0.5);
      return !m;
    });
    bumpControls();
  }

  const progress = duration > 0 ? (current / duration) * 100 : 0;
  const volPct = (muted ? 0 : volume) * 100;
  const canSeek = duration > 0 && Number.isFinite(duration);

  return (
    <div
      className={`player${controlsVisible || !playing ? " is-controls" : ""}${playing ? " is-playing" : ""}`}
      onPointerMove={bumpControls}
      onPointerDown={bumpControls}
    >
      <button
        type="button"
        className="player__stage"
        onClick={togglePlay}
        aria-label={playing ? "Пауза" : "Пуск"}
      >
        <video
          ref={videoRef}
          src={src}
          playsInline
          preload="auto"
          onTimeUpdate={onTimeUpdate}
          onLoadedMetadata={onLoadedMeta}
          onDurationChange={onDurationChange}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setControlsVisible(true);
          }}
        />
        <span className={`player__veil${playing && !controlsVisible ? " is-hidden" : ""}`} aria-hidden />
        {!playing && (
          <span className="player__big-play" aria-hidden>
            <span className="player__big-play__icon" />
            <span className="player__big-play__label">Смотреть</span>
          </span>
        )}
      </button>

      <div className="player__dock">
        {title ? <p className="player__caption">{title}</p> : null}

        <label
          className="player__seek"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="sr-only">Перемотка</span>
          <input
            type="range"
            min={0}
            max={canSeek ? duration : 1}
            step={0.1}
            value={Number.isFinite(current) ? current : 0}
            disabled={!canSeek}
            style={{ ["--progress" as string]: `${progress}%` }}
            onChange={(e) => onSeekInput(Number(e.target.value))}
            onPointerDown={() => {
              setSeeking(true);
              bumpControls();
            }}
            onPointerUp={(e) => onSeekCommit(Number((e.target as HTMLInputElement).value))}
            onPointerCancel={(e) => onSeekCommit(Number((e.target as HTMLInputElement).value))}
            onTouchEnd={(e) => onSeekCommit(Number((e.target as HTMLInputElement).value))}
            onKeyUp={(e) => onSeekCommit(Number((e.target as HTMLInputElement).value))}
          />
        </label>

        <div className="player__row">
          <div className="player__transport">
            <button
              type="button"
              className="player__chip"
              onClick={() => seekBy(-10)}
              disabled={!canSeek}
              aria-label="Назад 10 секунд"
            >
              −10
            </button>
            <button
              type="button"
              className="player__btn player__btn--play"
              onClick={togglePlay}
              aria-label={playing ? "Пауза" : "Пуск"}
            >
              {playing ? "Пауза" : "Пуск"}
            </button>
            <button
              type="button"
              className="player__chip"
              onClick={() => seekBy(10)}
              disabled={!canSeek}
              aria-label="Вперёд 10 секунд"
            >
              +10
            </button>
          </div>

          <div className="player__time" aria-live="off">
            <strong>{formatTime(current)}</strong>
            <span>/ {formatTime(duration)}</span>
          </div>

          <div className="player__sound">
            <button
              type="button"
              className="player__chip"
              onClick={toggleMute}
              aria-label={muted || volume === 0 ? "Включить звук" : "Выключить звук"}
            >
              {muted || volume === 0 ? "Звук" : "Тише"}
            </button>
            <label className="player__volume">
              <span className="sr-only">Громкость</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                style={{ ["--progress" as string]: `${volPct}%` }}
                onChange={(e) => onVolumeInput(Number(e.target.value))}
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
