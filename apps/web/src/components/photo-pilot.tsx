"use client";
import { useState } from "react";
import { api } from "@/lib/api";

type Observation = { feature: string; confidence: string; description: string };

export function PhotoPilot({ token }: { token: string }) {
  const [photo, setPhoto] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [result, setResult] = useState<Observation[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function assess() {
    if (!photo || !consent) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("photo", photo);
      form.append("consent", "true");
      const response = await api<{
        observations: { observations: Observation[] };
      }>("/v1/me/skin-photo", token, { method: "POST", body: form });
      setResult(response.observations.observations);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function erase() {
    setBusy(true);
    setError("");
    try {
      await api("/v1/me/skin-photo", token, { method: "DELETE" });
      setResult(null);
      setPhoto(null);
      setConsent(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="photo-pilot">
      <h3>
        Optional photo observations <span>EXPERIMENTAL</span>
      </h3>
      <p>
        This can describe visible shine, flaking, redness, or blemishes. It does
        not diagnose skin conditions or measure your skin type.
      </p>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(e) => setPhoto(e.target.files?.[0] || null)}
      />
      <label>
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />{" "}
        I consent to a temporary face-photo assessment.
      </label>
      <div className="photo-actions">
        <button
          className="secondary-button"
          disabled={!photo || !consent || busy}
          onClick={assess}
        >
          Assess visible features
        </button>
        {result && (
          <button className="secondary-button" disabled={busy} onClick={erase}>
            Delete my photo
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="field-note">
          {error}
        </p>
      )}
      {result && (
        <div className="photo-results">
          {result.length ? (
            result.map((o) => (
              <p key={o.feature}>
                <strong>{o.feature.replaceAll("_", " ")}</strong> (
                {o.confidence} confidence): {o.description}
              </p>
            ))
          ) : (
            <p>
              No reliable visible observations could be made from this image.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
