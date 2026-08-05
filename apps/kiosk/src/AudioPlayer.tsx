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

export function AudioPlayer({ src, active, title = "Аудиорассказ" }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seeking, setSeeking] = useState(false);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (!active) {
      el.pause();
      setPlaying(false);
    }
  }, [active]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    el.currentTime = 0;
    setPlaying(false);
    setCurrent(0);
  }, [src]);

  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      void el
        .play()
        .then(() => setPlaying(true))
        .catch(() => setPlaying(false));
    } else {
      el.pause();
      setPlaying(false);
    }
  }, []);

  function onTimeUpdate() {
    const el = audioRef.current;
    if (!el || seeking) return;
    setCurrent(el.currentTime);
  }

  function onLoadedMeta() {
    const el = audioRef.current;
    if (!el) return;
    setDuration(el.duration || 0);
  }

  function onSeekInput(value: number) {
    setCurrent(value);
    setSeeking(true);
  }

  function onSeekCommit(value: number) {
    const el = audioRef.current;
    if (el) el.currentTime = value;
    setCurrent(value);
    setSeeking(false);
  }

  return (
    <div className={`audio-player ${playing ? "is-playing" : ""}`}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoadedMeta}
        onEnded={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      <div className="audio-player__meta">
        <p className="section-kicker">Аудио</p>
        <p className="audio-player__title">{title}</p>
      </div>
      <button type="button" className="audio-player__play" onClick={togglePlay} aria-label={playing ? "Пауза" : "Слушать"}>
        {playing ? "❚❚" : "▶"}
      </button>
      <div className="audio-player__timeline">
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={current}
          aria-label="Позиция"
          onChange={(e) => onSeekInput(Number(e.target.value))}
          onPointerUp={(e) => onSeekCommit(Number((e.target as HTMLInputElement).value))}
          onTouchEnd={(e) => onSeekCommit(Number((e.target as HTMLInputElement).value))}
        />
        <div className="audio-player__times">
          <span>{formatTime(current)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
    </div>
  );
}
