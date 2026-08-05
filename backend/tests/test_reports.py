RULE_BODY = {
    "name": "6:3:1 baseline",
    "tolerance": 0.2,
    "exclude_tag_ids": [],
    "groups": [
        {"key": "A", "label": "Work", "ratio": 6, "tag_ids": [1]},
        {"key": "B", "label": "Kids", "ratio": 3, "tag_ids": [2]},
        {"key": "C", "label": "Fitness", "ratio": 1, "tag_ids": [3]},
    ],
}


async def _setup(client):
    for name, color in (("Work", "#DA96A4"), ("Kids", "#BDBD9B"), ("Fitness", "#8FA8A2")):
        await client.post("/api/tags", json={"name": name, "color": color})
    await client.post("/api/rules", json=RULE_BODY)
    for tag_id, hours in ((1, 6), (2, 3), (3, 1)):
        await client.post(
            "/api/events",
            json={
                "task_name": f"tag{tag_id}",
                "start_at": "2026-08-03T00:00:00",
                "end_at": f"2026-08-03T{hours:02d}:00:00",
                "tag_ids": [tag_id],
            },
        )


async def test_run_report_snapshots_the_active_rule(client):
    await _setup(client)
    active_id = (await client.get("/api/rules/active")).json()["id"]

    report = await client.post("/api/reports/run", json={"month": "2026-08"})
    assert report.status_code == 201
    body = report.json()
    assert body["rule_id"] == active_id
    assert body["period_start"] == "2026-08-01"
    assert body["period_end"] == "2026-08-31"
    assert body["metrics"]["has_data"] is True


async def test_rerunning_appends_rather_than_overwrites(client):
    await _setup(client)
    first = (await client.post("/api/reports/run", json={"month": "2026-08"})).json()
    second = (await client.post("/api/reports/run", json={"month": "2026-08"})).json()
    assert first["id"] != second["id"]

    listed = (await client.get("/api/reports", params={"month": "2026-08"})).json()
    assert len(listed) == 2
    assert listed[0]["id"] == second["id"]  # newest first


async def test_changing_the_rule_leaves_old_reports_untouched(client):
    await _setup(client)
    original = (await client.post("/api/reports/run", json={"month": "2026-08"})).json()

    loosened = {**RULE_BODY, "name": "loosened", "tolerance": 0.5}
    await client.post("/api/rules", json=loosened)

    refetched = (await client.get(f"/api/reports/{original['id']}")).json()
    # The report row itself is untouched: same rule_id, metrics, narrative, etc.
    # `rule` is a live join on that id, not a frozen copy, so its `effective_to`
    # legitimately flips once create_rule_version closes the superseded rule —
    # that is the rule row changing, not the report.
    assert {k: v for k, v in refetched.items() if k != "rule"} == {
        k: v for k, v in original.items() if k != "rule"
    }
    assert refetched["rule"]["id"] == original["rule"]["id"]
    assert refetched["rule"]["name"] == original["rule"]["name"]
    assert refetched["rule"]["groups"] == original["rule"]["groups"]
    assert original["rule"]["effective_to"] is None
    assert refetched["rule"]["effective_to"] is not None


async def test_new_report_uses_the_now_current_rule(client):
    await _setup(client)
    await client.post("/api/reports/run", json={"month": "2026-08"})

    loosened = {**RULE_BODY, "name": "loosened", "tolerance": 0.5}
    new_rule_id = (await client.post("/api/rules", json=loosened)).json()["id"]

    latest = (await client.post("/api/reports/run", json={"month": "2026-08"})).json()
    assert latest["rule_id"] == new_rule_id


async def test_reports_have_no_patch_route(client):
    await _setup(client)
    report_id = (await client.post("/api/reports/run", json={"month": "2026-08"})).json()["id"]
    assert (await client.patch(f"/api/reports/{report_id}", json={})).status_code == 405


async def test_report_without_rule_returns_409(client):
    assert (await client.post("/api/reports/run", json={"month": "2026-08"})).status_code == 409


async def test_delete_report(client):
    await _setup(client)
    report_id = (await client.post("/api/reports/run", json={"month": "2026-08"})).json()["id"]
    assert (await client.delete(f"/api/reports/{report_id}")).status_code == 204
    assert (await client.get(f"/api/reports/{report_id}")).status_code == 404


async def test_malformed_month_filter_is_422_not_500(client):
    """The list filter used to slice the string itself, so anything unparseable
    reached int() and surfaced as a 500."""
    for bad in ("garbage", "2026", "2026-13", "0000-01", ""):
        got = await client.get("/api/reports", params={"month": bad})
        assert got.status_code == 422, bad


def test_month_bounds_handles_december_and_leap_february():
    """December must roll the year rather than reaching month 13, and a leap
    February must be 29 days. Neither had coverage."""
    from datetime import date, datetime

    from app.services.reports import month_bounds

    first, last, start_dt, end_dt = month_bounds(2026, 12)
    assert (first, last) == (date(2026, 12, 1), date(2026, 12, 31))
    assert start_dt == datetime(2026, 12, 1)
    assert end_dt == datetime(2027, 1, 1)

    first, last, _, end_dt = month_bounds(2028, 2)
    assert (first, last) == (date(2028, 2, 1), date(2028, 2, 29))
    assert end_dt == datetime(2028, 3, 1)


async def test_deleting_a_rule_a_report_snapshots_is_409(client):
    """A report freezes rule_id forever, so that rule must become undeletable."""
    await _setup(client)
    rule_id = (await client.get("/api/rules/active")).json()["id"]
    await client.post("/api/reports/run", json={"month": "2026-08"})

    blocked = await client.delete(f"/api/rules/{rule_id}")
    assert blocked.status_code == 409
    assert (await client.get(f"/api/rules/{rule_id}")).status_code == 200


async def test_deleting_an_unreferenced_rule_still_works(client):
    """A superseded rule no report ever snapshotted stays removable."""
    await _setup(client)
    superseded_id = (await client.get("/api/rules/active")).json()["id"]
    await client.post("/api/rules", json={**RULE_BODY, "name": "successor"})

    assert (await client.delete(f"/api/rules/{superseded_id}")).status_code == 204


async def test_report_embeds_the_rule_it_snapshotted(client):
    """The Review header must name the rule version without an N+1 fetch."""
    await _setup(client)
    report = (await client.post("/api/reports/run", json={"month": "2026-08"})).json()

    assert report["rule"]["id"] == report["rule_id"]
    assert report["rule"]["name"] == "6:3:1 baseline"
    assert [g["ratio"] for g in report["rule"]["groups"]] == [6, 3, 1]
    assert report["rule"]["effective_from"] is not None
