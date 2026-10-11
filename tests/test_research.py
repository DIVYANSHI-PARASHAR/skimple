import json
from types import SimpleNamespace

import httpx
import pytest
from skimple import research


def test_study_extraction_keeps_client_open_until_response(monkeypatch):
    class Client:
        active = False
        closed = False

        def __init__(self):
            self.models = self

        def __enter__(self):
            self.active = True
            return self

        def __exit__(self, *args):
            self.active = False
            self.closed = True

        def generate_content(self, **kwargs):
            assert self.active and not self.closed
            assert "Source abstract" in kwargs["contents"]
            return SimpleNamespace(
                text=json.dumps(
                    {
                        "outcome": "hydration",
                        "route": "topical",
                        "design": "unknown",
                        "effect_direction": "uncertain",
                    }
                )
            )

    client = Client()
    monkeypatch.setattr(research, "gemini_client", lambda: client)
    finding = research.extract_study("Source abstract", "Glycerin")
    assert finding.effect_direction == "uncertain"
    assert finding.sample_size is None
    assert client.closed


@pytest.mark.parametrize(
    "annotation",
    [
        "<PublicationType>Retracted Publication</PublicationType>",
        '<CommentsCorrections RefType="RetractionIn"><PMID>999</PMID></CommentsCorrections>',
    ],
)
def test_pubmed_retraction_and_authors_are_taken_from_verified_xml(monkeypatch, annotation):
    xml = f"""<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>123</PMID>
    <Article><ArticleTitle>Source title</ArticleTitle><Abstract>Source abstract</Abstract>
    <AuthorList><Author><ForeName>Ada</ForeName><LastName>Smith</LastName></Author>
    <Author><CollectiveName>Trial Group</CollectiveName></Author></AuthorList>
    <Journal><Title>Source journal</Title><JournalIssue><PubDate><Year>2020</Year>
    </PubDate></JournalIssue></Journal>{annotation}</Article></MedlineCitation>
    </PubmedArticle></PubmedArticleSet>"""
    transport = httpx.MockTransport(lambda request: httpx.Response(200, text=xml))
    client_class = httpx.Client
    monkeypatch.setattr(
        research.httpx, "Client", lambda **kwargs: client_class(transport=transport)
    )
    record = research.fetch_pubmed("123")
    assert record["is_retracted"]
    assert record["authors"] == ["Ada Smith", "Trial Group"]
    with pytest.raises(ValueError, match="verify the PMID"):
        research.fetch_pubmed("456")


def test_refresh_drops_stale_extractions_and_does_not_call_gemini(monkeypatch, tmp_path):
    path = tmp_path / "papers.json"
    path.write_text(
        json.dumps(
            {
                "method": "test",
                "papers": [
                    {
                        "pmid": "123",
                        "abstract": "old abstract",
                        "ingredients": ["Glycerin"],
                        "findings": [{"stale": True}],
                    }
                ],
                "searches": [{"ingredient": "Glycerin"}],
            }
        )
    )
    monkeypatch.setattr(research, "search_pubmed", lambda name, limit: ["123"])
    monkeypatch.setattr(
        research,
        "fetch_pubmed",
        lambda pmid: {"pmid": pmid, "abstract": "updated abstract", "doi": None},
    )
    monkeypatch.setattr(research, "enrich_openalex", lambda doi: {})
    monkeypatch.setattr(research.time, "sleep", lambda seconds: None)

    def no_extraction(*args):
        raise AssertionError("Gemini is opt-in")

    monkeypatch.setattr(research, "extract_study", no_extraction)
    assert research.refresh_snapshot(path)["gemini_extraction"] is False
    refreshed = json.loads(path.read_text())
    assert refreshed["papers"][0]["findings"] == []
    assert refreshed["searches"][0]["pmids"] == ["123"]


def test_failed_snapshot_refresh_preserves_the_original_file(monkeypatch, tmp_path):
    path = tmp_path / "papers.json"
    original = json.dumps({"papers": [{"pmid": "123"}], "searches": []})
    path.write_text(original)

    def unavailable(*args):
        raise RuntimeError("Source unavailable")

    monkeypatch.setattr(research, "fetch_pubmed", unavailable)
    with pytest.raises(RuntimeError):
        research.refresh_snapshot(path)
    assert path.read_text() == original
