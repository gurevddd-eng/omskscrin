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
};

export function VideoPlayer({ src, active }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.85);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seeking, setSeeking] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bumpControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setControlsVisible(false);
    }, 2800);
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
      void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      el.pause();
      setPlaying(false);
      setControlsVisible(true);
    }
  }, [bumpControls]);

  function onTimeUpdate() {
    const el = videoRef.current;
    if (!el || seeking) return;
    setCurrent(el.currentTime);
  }

  function onLoadedMeta() {
    const el = videoRef.current;
    if (!el) return;
    setDuration(el.duration || 0);
  }

  function onSeekInput(value: number) {
    setCurrent(value);
    setSeeking(true);
    bumpControls();
  }

  function onSeekCommit(value: number) {
    const el = videoRef.current;
    if (el) el.currentTime = value;
    setCurrent(value);
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

  return (
    <div
      className={`player${controlsVisible || !playing ? " is-controls" : ""}`}
      onPointerMove={bumpControls}
      onPointerDown={bumpControls}
    >
      <button type="button" className="player__stage" onClick={togglePlay} aria-label={playing ? "Пауза" : "Пуск"}>
        <video
          ref={videoRef}
          src={src}
          playsInline
          preload="auto"
          onTimeUpdate={onTimeUpdate}
          onLoadedMetadata={onLoadedMeta}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setControlsVisible(true);
          }}
        />
        {!playing && (
          <span className="player__big-play" aria-hidden>
            <span>Пуск</span>
          </span>
        )}
      </button>

      <div className="player__bar">
        <button type="button" className="player__btn player__btn--play" onClick={togglePlay}>
          {playing ? "Пауза" : "Пуск"}
        </button>

        <div className="player__time">{formatTime(current)}</div>

        <label className="player__seek">
          <span className="sr-only">Перемотка</span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Number.isFinite(current) ? current : 0}
            disabled={!duration}
            style={{ ["--progress" as string]: `${progress}%` }}
            onChange={(e) => onSeekInput(Number(e.target.value))}
            onPointerUp={(e) => onSeekCommit(Number((e.target as HTMLInputElement).value))}
            onKeyUp={(e) => onSeekCommit(Number((e.target as HTMLInputElement).value))}
          />
        </label>

        <div className="player__time player__time--end">{formatTime(duration)}</div>

        <button type="button" className="player__btn player__btn--mute" onClick={toggleMute}>
          {muted || volume === 0 ? "Звук" : "Тише"}
        </button>

        <label className="player__volume">
          <span className="player__vol-label">Громкость</span>
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
  );
}
