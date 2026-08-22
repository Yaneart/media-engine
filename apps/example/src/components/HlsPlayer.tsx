import type HlsInstance from "hls.js";
import { useEffect, useRef, useState } from "react";

export function HlsPlayer({ title, url }: { title: string; url: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setError(undefined);
    setStatus("loading");
    const handleCanPlay = () => setStatus("ready");
    video.addEventListener("canplay", handleCanPlay);

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      return () => {
        video.removeEventListener("canplay", handleCanPlay);
        resetVideo(video);
      };
    }

    let disposed = false;
    let hls: HlsInstance | undefined;

    void import("hls.js")
      .then(({ default: Hls }) => {
        if (disposed) return;
        if (!Hls.isSupported()) {
          setError("Этот браузер не поддерживает воспроизведение HLS.");
          setStatus("error");
          return;
        }

        hls = new Hls();
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            setError("Поток не удалось загрузить. Попробуйте другое качество или озвучку.");
            setStatus("error");
          }
        });
      })
      .catch(() => {
        if (!disposed) {
          setError("Не удалось запустить HLS-плеер.");
          setStatus("error");
        }
      });

    return () => {
      disposed = true;
      hls?.destroy();
      video.removeEventListener("canplay", handleCanPlay);
      resetVideo(video);
    };
  }, [url]);

  return (
    <div className="stream-player">
      <video controls playsInline preload="metadata" ref={videoRef} title={title} />
      {status === "loading" ? (
        <span className="stream-player__status">Загружаем видео и определяем длительность…</span>
      ) : null}
      {status === "ready" ? (
        <span className="stream-player__status stream-player__status--ready">
          Видео готово. Нажмите ▶ для просмотра.
        </span>
      ) : null}
      {error ? <span className="stream-player__error">{error}</span> : null}
    </div>
  );
}

function resetVideo(video: HTMLVideoElement): void {
  video.pause();
  video.removeAttribute("src");
  video.load();
}
