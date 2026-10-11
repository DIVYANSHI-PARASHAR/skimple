from redis import Redis
from rq.job import Job
from skimple import jobs


def test_enqueue_uses_rq_valid_job_id(monkeypatch):
    created = []

    class RecordingQueue:
        def __init__(self, name, connection):
            self.name = name
            self.connection = connection

        def enqueue(self, function, identifier, **options):
            created.append(
                Job.create(
                    function,
                    args=(identifier,),
                    id=options["job_id"],
                    connection=self.connection,
                )
            )

    monkeypatch.setattr(jobs, "Queue", RecordingQueue)
    monkeypatch.setattr(jobs.Redis, "from_url", lambda url: Redis())

    jobs.enqueue("scans", jobs.run_extraction, "scan-id")
    jobs.enqueue("analyses", jobs.run_analysis, "analysis-id")

    assert [job.id for job in created] == ["scans_scan-id", "analyses_analysis-id"]
