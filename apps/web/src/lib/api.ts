export type Scan = {
  scan_id: string;
  status: string;
  extraction: Extraction | null;
  verification: {
    candidates: { title: string; url: string; description: string }[];
    note: string;
  } | null;
  formulation_id: string | null;
  error_code: string | null;
};
export type Extraction = {
  brand: string;
  product_name: string;
  variant: string;
  size: string;
  barcode_if_visible: string;
  raw_ingredient_text: string;
  ingredients_in_order: string[];
  language: string;
  uncertain_fields: string[];
  incomplete_ingredients: boolean;
};
export type Analysis = {
  analysis_id: string;
  status: string;
  report_id: string | null;
  error_code: string | null;
};
export type Report = {
  report_id: string;
  created_at: string;
  compatibility: {
    classification: string;
    benefit_fit_score: number | null;
    irritation_concern: string;
    confidence: string;
    known_reaction_ingredients: string[];
    limitations: string[];
  };
  ingredient_findings: {
    ingredient: string;
    outcome: string;
    effect: string;
    evidence_confidence: string;
    claim_id: string;
    paper_ids: string[];
    synthesis: string;
    papers: {
      id: string;
      title: string;
      year: number | null;
      url: string;
      pmid: string | null;
      doi: string | null;
      relation: string;
    }[];
  }[];
  review_signal: {
    observation_count: number;
    source_count: number;
    sources: string[];
    source_urls: string[];
    last_refreshed: string | null;
    aspects: { aspect: string; sentiment: string; count: number }[];
    note: string;
  };
  alternatives: {
    formulation_id: string;
    brand: string;
    product_name: string;
    variant: string;
    category: string;
    benefit_fit_score: number | null;
    confidence: string;
    reason: string;
    limitations: string[];
  }[];
  disclaimer: string;
};

const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function api<T>(
  path: string,
  visitorKey: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("X-Visitor-Key", visitorKey);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers,
    cache: "no-store",
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      message = (await response.json()).detail || message;
    } catch {
      /* HTTP error without JSON */
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}
