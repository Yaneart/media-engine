import type HlsInstance from "hls.js";
import { useEffect, useRef, useState } from "react";

export function HlsPlayer({ url, title }: { url: string; title: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setError(undefined);

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;

      return () => resetVideo(video);
    }

    let disposed = false;
    let hls: HlsInstance | undefined;

    void import("hls.js")
      .then(({ default: Hls }) => {
        if (disposed) return;

        if (!Hls.isSupported()) {
          setError("HLS playback is not supported by this browser.");
          return;
        }

        hls = new Hls();
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            setError("The HLS stream could not be loaded. Try another quality or player.");
          }
        });
      })
      .catch(() => {
        if (!disposed) {
          setError("The HLS player could not be initialized.");
        }
      });

    return () => {
      disposed = true;
      hls?.destroy();
      resetVideo(video);
    };
  }, [url]);

  return (
    <div className="stream-player">
      <video controls playsInline preload="metadata" ref={videoRef} title={title} />
      {error ? (
        <span className="stream-player__error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function resetVideo(video: HTMLVideoElement): void {
  video.pause();
  video.removeAttribute("src");
  video.load();
}
