"use client";
import { useCallback, useEffect, useState } from "react";
import { Camera } from "@/components/camera";
import { PhotoPilot } from "@/components/photo-pilot";
import { useVisitorKey } from "@/components/providers";
import { api, Analysis, Extraction, Report, Scan } from "@/lib/api";

type Step = "scan" | "confirm" | "profile" | "working" | "report";
const initialProfile = {
  after_cleansing: "unsure",
  daytime_oiliness: "unsure",
  dry_areas: [] as string[],
  oily_areas: [] as string[],
  sensitivity: "unsure",
  known_reactions: [] as string[],
  goals: [] as string[],
  routine: "",
  notes: "",
};

export default function Home() {
  const visitorKey = useVisitorKey();
  const [step, setStep] = useState<Step>("scan");
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [form, setForm] = useState({
    brand: "",
    product_name: "",
    variant: "",
    region: "unknown",
    category: "other",
    barcode: "",
    raw_ingredient_text: "",
    ingredients_text: "",
  });
  const [profile, setProfile] = useState(initialProfile);
  const [reactionText, setReactionText] = useState("");
  const [dryAreasText, setDryAreasText] = useState("");
  const [oilyAreasText, setOilyAreasText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadScan = useCallback(
    async (id: string) => {
      if (!visitorKey) return;
      const next = await api<Scan>(`/v1/scans/${id}`, visitorKey);
      setScan(next);
      if (next.status === "NEEDS_CONFIRMATION" && next.extraction) {
        const x: Extraction = next.extraction;
        setForm({
          brand: x.brand,
          product_name: x.product_name,
          variant: x.variant,
          region: "unknown",
          category: "other",
          barcode: x.barcode_if_visible,
          raw_ingredient_text: x.raw_ingredient_text,
          ingredients_text: x.ingredients_in_order.join("\n"),
        });
        setStep("confirm");
      }
      if (next.status === "FAILED")
        setError(
          "We couldn’t read the label. Please retake clear photos and try again.",
        );
    },
    [visitorKey],
  );

  useEffect(() => {
    if (
      !scan ||
      !["CREATED", "EXTRACTING", "IDENTIFYING", "RETRYING"].includes(
        scan.status,
      )
    )
      return;
    const timer = window.setInterval(() => {
      void loadScan(scan.scan_id).catch((e) => setError(String(e)));
    }, 2000);
    return () => window.clearInterval(timer);
  }, [scan, loadScan]);

  useEffect(() => {
    if (
      !analysis ||
      !visitorKey ||
      !["CREATED", "REVIEW_ANALYSIS", "SCORING", "RETRYING"].includes(
        analysis.status,
      )
    )
      return;
    const timer = window.setInterval(async () => {
      try {
        const next = await api<Analysis>(
          `/v1/analyses/${analysis.analysis_id}`,
          visitorKey,
        );
        setAnalysis(next);
        if (next.report_id) {
          setReport(
            await api<Report>(`/v1/reports/${next.report_id}`, visitorKey),
          );
          setStep("report");
        }
        if (next.status === "FAILED")
          setError("The analysis could not finish. Please try again.");
      } catch (e) {
        setError(String(e));
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [analysis, visitorKey]);

  async function upload() {
    if (!front || !back || !visitorKey) return;
    setError("");
    setBusy(true);
    try {
      const data = new FormData();
      data.append("front", front);
      data.append("back", back);
      const created = await api<{ scan_id: string; status: string }>(
        "/v1/scans",
        visitorKey,
        {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: data,
        },
      );
      await loadScan(created.scan_id);
      setScan(
        (previous) =>
          previous || {
            scan_id: created.scan_id,
            status: created.status,
            extraction: null,
            verification: null,
            formulation_id: null,
            error_code: null,
          },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!scan || !visitorKey) return;
    const ingredients = form.ingredients_text
      .split(/[\n,;]+/)
      .map((v) => v.trim())
      .filter(Boolean);
    if (!ingredients.length) {
      setError("Add the full ingredients list before continuing.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(`/v1/scans/${scan.scan_id}/confirm`, visitorKey, {
        method: "POST",
        body: JSON.stringify({
          brand: form.brand,
          product_name: form.product_name,
          variant: form.variant,
          region: form.region,
          category: form.category,
          barcode: form.barcode,
          raw_ingredient_text:
            form.raw_ingredient_text || ingredients.join(", "),
          ingredients_in_order: ingredients,
        }),
      });
      setStep("profile");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function beginAnalysis() {
    if (!scan || !visitorKey) return;
    setBusy(true);
    setError("");
    try {
      await api("/v1/me/skin-profile", visitorKey, {
        method: "PUT",
        body: JSON.stringify({
          ...profile,
          known_reactions: reactionText
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
          dry_areas: dryAreasText
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
          oily_areas: oilyAreasText
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
        }),
      });
      const created = await api<Analysis>("/v1/analyses", visitorKey, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ scan_id: scan.scan_id }),
      });
      setAnalysis(created);
      setStep("working");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const restart = () => {
    setStep("scan");
    setFront(null);
    setBack(null);
    setScan(null);
    setAnalysis(null);
    setReport(null);
    setError("");
  };
  return (
    <main className="site-shell">
      <header className="site-header">
        <div className="brand">
          <span className="brand-mark">✳</span> skimple
          <span className="brand-period">.</span>
        </div>
        <div className="header-right">
          <span className="header-tag">SKINCARE, CLARIFIED</span>
        </div>
      </header>
      <section className="hero">
        <div className="eyebrow">
          <span className="eyebrow-dot" /> YOUR SKIN, BETTER INFORMED
        </div>
        <h1>
          Know what’s <em>inside.</em>
          <br />
          Understand what it means.
        </h1>
        <p>
          Scan a skincare product and get a clear, evidence-aware look at its
          ingredients, reviews, and how it may fit your skin.
        </p>
      </section>
      <>
        <nav className="progress" aria-label="Progress">
          {["Scan", "Verify", "Your skin", "Report"].map((label, i) => (
            <div
              key={label}
              className={`progress-item ${["scan", "confirm", "profile", "working", "report"].indexOf(step) >= [0, 1, 2, 3][i] ? "current" : ""}`}
            >
              <span>{String(i + 1).padStart(2, "0")}</span>
              {label}
            </div>
          ))}
        </nav>
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
        {step === "scan" && (
          <section className="main-card">
            <div className="card-kicker">START WITH THE LABEL</div>
            <h2>Let’s scan your product.</h2>
            <p className="card-intro">
              Good lighting and a sharp ingredient photo make the biggest
              difference. You can review every detail before analysis.
            </p>
            <div className="camera-grid">
              <Camera label="Front" file={front} onChange={setFront} />
              <Camera label="Back" file={back} onChange={setBack} />
            </div>
            <div className="card-footer">
              <div className="privacy-note">
                ✧ Photos are stored privately and set to expire.
              </div>
              <button
                className="primary-button"
                disabled={!front || !back || !visitorKey || busy}
                onClick={upload}
              >
                {busy ? "Uploading…" : "Identify product"}
                <span>→</span>
              </button>
            </div>
            {scan &&
              ["CREATED", "EXTRACTING", "IDENTIFYING", "RETRYING"].includes(
                scan.status,
              ) && (
                <p className="working-note">
                  Reading the label and checking product details…
                </p>
              )}
          </section>
        )}
        {step === "confirm" && (
          <section className="main-card">
            <div className="card-kicker">YOU’RE IN CONTROL</div>
            <h2>Check the label details.</h2>
            <p className="card-intro">
              Your package is the source for this specific bottle. Correct
              anything the scan missed before continuing.
            </p>
            {scan?.extraction?.incomplete_ingredients && (
              <div className="notice">
                The ingredient list may be incomplete. Compare it closely with
                your package.
              </div>
            )}
            {scan?.extraction?.uncertain_fields?.length ? (
              <div className="notice">
                Uncertain fields: {scan.extraction.uncertain_fields.join(", ")}
              </div>
            ) : null}
            <div className="form-grid">
              <label>
                Brand
                <input
                  value={form.brand}
                  onChange={(e) => setForm({ ...form, brand: e.target.value })}
                />
              </label>
              <label>
                Product name
                <input
                  value={form.product_name}
                  onChange={(e) =>
                    setForm({ ...form, product_name: e.target.value })
                  }
                />
              </label>
              <label>
                Variant
                <input
                  value={form.variant}
                  onChange={(e) =>
                    setForm({ ...form, variant: e.target.value })
                  }
                />
              </label>
              <label>
                Region or market
                <input
                  value={form.region}
                  onChange={(e) => setForm({ ...form, region: e.target.value })}
                />
              </label>
              <label>
                Category
                <select
                  value={form.category}
                  onChange={(e) =>
                    setForm({ ...form, category: e.target.value })
                  }
                >
                  <option value="other">Other</option>
                  <option value="cleanser">Cleanser</option>
                  <option value="moisturizer">Moisturizer</option>
                  <option value="serum">Serum</option>
                  <option value="sunscreen">Sunscreen</option>
                  <option value="treatment">Treatment</option>
                </select>
              </label>
              <label>
                Barcode, if visible
                <input
                  value={form.barcode}
                  onChange={(e) =>
                    setForm({ ...form, barcode: e.target.value })
                  }
                />
              </label>
            </div>
            <label className="wide-label">
              Ingredients in order{" "}
              <small>One per line; edit against the package</small>
              <textarea
                rows={9}
                value={form.ingredients_text}
                onChange={(e) =>
                  setForm({ ...form, ingredients_text: e.target.value })
                }
              />
            </label>
            {scan?.verification?.candidates?.length ? (
              <div className="sources">
                <h3>Possible product pages</h3>
                <p>These are clues, not a substitute for your package.</p>
                {scan.verification.candidates.map((c, index) =>
                  c.url ? (
                    <a
                      key={`${c.url}-${index}`}
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {c.title || c.url} ↗
                    </a>
                  ) : (
                    <span
                      className="catalog-candidate"
                      key={`catalog-${index}`}
                    >
                      {c.title} · {c.description}
                    </span>
                  ),
                )}
              </div>
            ) : null}
            <div className="card-footer">
              <button className="secondary-button" onClick={restart}>
                Start over
              </button>
              <button
                className="primary-button"
                disabled={busy}
                onClick={confirm}
              >
                {busy ? "Saving…" : "Confirm formula"}
                <span>→</span>
              </button>
            </div>
          </section>
        )}
        {step === "profile" && (
          <section className="main-card">
            <div className="card-kicker">A LITTLE ABOUT YOU</div>
            <h2>What is your skin like?</h2>
            <p className="card-intro">
              Your answers guide conservative checks. They don’t diagnose your
              skin.
            </p>
            <div className="form-grid">
              <label>
                After cleansing, your skin feels
                <select
                  value={profile.after_cleansing}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      after_cleansing: e.target.value,
                    })
                  }
                >
                  <option value="unsure">Not sure</option>
                  <option value="tight">Tight</option>
                  <option value="comfortable">Comfortable</option>
                  <option value="oily">Oily</option>
                  <option value="varies">It varies</option>
                </select>
              </label>
              <label>
                Oiliness during the day
                <select
                  value={profile.daytime_oiliness}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      daytime_oiliness: e.target.value,
                    })
                  }
                >
                  <option value="unsure">Not sure</option>
                  <option value="none">Little or none</option>
                  <option value="some">Some</option>
                  <option value="high">A lot</option>
                  <option value="varies">It varies</option>
                </select>
              </label>
              <label>
                Sensitivity to products
                <select
                  value={profile.sensitivity}
                  onChange={(e) =>
                    setProfile({ ...profile, sensitivity: e.target.value })
                  }
                >
                  <option value="unsure">Not sure</option>
                  <option value="low">Rarely react</option>
                  <option value="medium">Sometimes react</option>
                  <option value="high">Often react</option>
                </select>
              </label>
              <label>
                Known ingredient reactions
                <input
                  value={reactionText}
                  placeholder="Comma-separated names"
                  onChange={(e) => setReactionText(e.target.value)}
                />
              </label>
              <label>
                Areas that feel dry
                <input
                  value={dryAreasText}
                  placeholder="For example, cheeks"
                  onChange={(e) => setDryAreasText(e.target.value)}
                />
              </label>
              <label>
                Areas that feel oily
                <input
                  value={oilyAreasText}
                  placeholder="For example, forehead"
                  onChange={(e) => setOilyAreasText(e.target.value)}
                />
              </label>
            </div>
            <div className="goals">
              <strong>What are your goals?</strong>
              <div>
                {[
                  { key: "hydration", label: "Hydration" },
                  { key: "blemishes", label: "Blemishes" },
                  { key: "tone", label: "Even tone" },
                  { key: "barrier", label: "Skin barrier" },
                  { key: "texture", label: "Texture" },
                ].map((g) => (
                  <button
                    key={g.key}
                    type="button"
                    className={profile.goals.includes(g.key) ? "selected" : ""}
                    onClick={() =>
                      setProfile({
                        ...profile,
                        goals: profile.goals.includes(g.key)
                          ? profile.goals.filter((x) => x !== g.key)
                          : [...profile.goals, g.key],
                      })
                    }
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="wide-label">
              Current routine <small>Optional</small>
              <textarea
                rows={3}
                value={profile.routine}
                onChange={(e) =>
                  setProfile({ ...profile, routine: e.target.value })
                }
              />
            </label>
            {process.env.NEXT_PUBLIC_ENABLE_FACE_PHOTO === "true" &&
              visitorKey && <PhotoPilot visitorKey={visitorKey} />}
            <div className="card-footer">
              <button
                className="secondary-button"
                onClick={() => setStep("confirm")}
              >
                Back
              </button>
              <button
                className="primary-button"
                disabled={busy}
                onClick={beginAnalysis}
              >
                {busy ? "Saving…" : "Create my report"}
                <span>→</span>
              </button>
            </div>
          </section>
        )}
        {step === "working" && (
          <section className="main-card working-card">
            <div className="spinner" />
            <div className="card-kicker">PUTTING IT TOGETHER</div>
            <h2>Building your report.</h2>
            <p>
              We’re checking the confirmed formula against available evidence
              and permitted product reviews.
            </p>
            <small>
              Current stage:{" "}
              {analysis?.status.toLowerCase().replaceAll("_", " ")}
            </small>
            {analysis?.status === "FAILED" && (
              <button className="secondary-button" onClick={restart}>
                Start a new scan
              </button>
            )}
          </section>
        )}
        {step === "report" && report && (
          <section className="main-card report-card">
            <div className="card-kicker">YOUR PRODUCT REPORT</div>
            <h2>
              {form.brand} {form.product_name}
            </h2>
            <p className="report-date">
              Created {new Date(report.created_at).toLocaleDateString()}
            </p>
            <div className="result-banner">
              <span>COMPATIBILITY</span>
              <strong>
                {report.compatibility.classification.replaceAll("_", " ")}
              </strong>
              <p>{report.disclaimer}</p>
            </div>
            {report.compatibility.known_reaction_ingredients.length > 0 && (
              <div className="warning">
                Known reaction match:{" "}
                {report.compatibility.known_reaction_ingredients.join(", ")}.
                Consider avoiding this product and consulting a clinician if
                unsure.
              </div>
            )}
            <div className="report-grid">
              <div>
                <small>BENEFIT FIT</small>
                <strong>
                  {report.compatibility.benefit_fit_score ?? "Unknown"}
                  {report.compatibility.benefit_fit_score === null
                    ? ""
                    : "/100"}
                </strong>
              </div>
              <div>
                <small>EVIDENCE CONFIDENCE</small>
                <strong>{report.compatibility.confidence}</strong>
              </div>
              <div>
                <small>IRRITATION CONCERN</small>
                <strong>
                  {report.compatibility.irritation_concern.replaceAll("_", " ")}
                </strong>
              </div>
            </div>
            <h3>What the evidence says</h3>
            {report.ingredient_findings.length ? (
              report.ingredient_findings.map((f) => (
                <div className="finding" key={f.claim_id}>
                  <strong>
                    {f.ingredient} · {f.outcome.replaceAll("_", " ")}
                  </strong>
                  <p>{f.synthesis}</p>
                  <small>
                    {f.evidence_confidence} confidence · {f.paper_ids.length}{" "}
                    linked paper(s)
                  </small>
                  <div className="paper-links">
                    {f.papers.map((p) => (
                      <a
                        key={p.id}
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {p.title} {p.year ? `(${p.year})` : ""} · {p.relation} ↗
                      </a>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <p className="empty-state">
                No reviewed, source-linked claims are available for this
                formulation yet. We won’t guess at benefits.
              </p>
            )}
            <h3>Review experiences</h3>
            {report.review_signal.last_refreshed && (
              <p className="report-date">
                Last checked{" "}
                {new Date(
                  report.review_signal.last_refreshed,
                ).toLocaleDateString()}
              </p>
            )}
            <p className="empty-state">
              {report.review_signal.observation_count
                ? `${report.review_signal.observation_count} classified observations from ${report.review_signal.source_count} permitted source(s).`
                : "No permitted, product-matched review observations are available yet."}
            </p>
            <div className="paper-links">
              {report.review_signal.source_urls.map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer">
                  Review source ↗
                </a>
              ))}
            </div>
            {report.alternatives.length > 0 && (
              <>
                <h3>Other products to compare</h3>
                {report.alternatives.map((a) => (
                  <div className="finding" key={a.formulation_id}>
                    <strong>
                      {a.brand} {a.product_name} {a.variant}
                    </strong>
                    <p>{a.reason}</p>
                    <small>
                      Benefit fit: {a.benefit_fit_score ?? "unknown"} ·{" "}
                      {a.confidence} evidence confidence
                    </small>
                  </div>
                ))}
              </>
            )}
            <h3>What remains uncertain</h3>
            <ul className="limitations">
              {report.compatibility.limitations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <div className="card-footer">
              <button className="secondary-button" onClick={restart}>
                Scan another product
              </button>
            </div>
          </section>
        )}
      </>
      <footer className="site-footer">
        <span>skimple.</span>
        <span>Clearer choices begin with better information.</span>
      </footer>
    </main>
  );
}
