"use client";
import { useEffect, useRef, useState } from "react";

export function Camera({
  label,
  file,
  onChange,
}: {
  label: string;
  file: File | null;
  onChange: (file: File | null) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(
    () => () => {
      stream.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );
  async function start() {
    try {
      setError("");
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      stream.current = media;
      if (video.current) video.current.srcObject = media;
      setActive(true);
    } catch {
      setError("Camera unavailable. Choose a photo instead.");
    }
  }
  function stop() {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setActive(false);
  }
  function capture() {
    const view = video.current;
    if (!view || !view.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = view.videoWidth;
    canvas.height = view.videoHeight;
    canvas.getContext("2d")?.drawImage(view, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob)
          onChange(
            new File([blob], `${label.toLowerCase()}.jpg`, {
              type: "image/jpeg",
            }),
          );
        stop();
      },
      "image/jpeg",
      0.92,
    );
  }
  return (
    <div className="camera-card">
      <div className="camera-heading">
        <span className="camera-icon">{label === "Front" ? "01" : "02"}</span>
        <div>
          <strong>{label} of package</strong>
          <small>
            {label === "Front"
              ? "Show brand, name and variant"
              : "Show the full ingredients list"}
          </small>
        </div>
      </div>
      {preview ? (
        <div className="camera-preview">
          <img src={preview} alt={`${label} package preview`} />
          <button type="button" onClick={() => onChange(null)}>
            Retake
          </button>
        </div>
      ) : active ? (
        <div className="camera-preview">
          <video ref={video} autoPlay playsInline muted />
          <button type="button" onClick={capture}>
            Capture photo
          </button>
          <button type="button" className="text-button" onClick={stop}>
            Cancel camera
          </button>
        </div>
      ) : (
        <div className="camera-actions">
          <button type="button" onClick={start}>
            Use camera
          </button>
          <label className="upload-button">
            Choose image
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={(event) => onChange(event.target.files?.[0] || null)}
            />
          </label>
        </div>
      )}
      {error && <p className="field-note">{error}</p>}
    </div>
  );
}
