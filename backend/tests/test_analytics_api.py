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


async def test_evaluate_period_uses_active_rule(client):
    await _setup(client)
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

    result = await client.post(
        "/api/analytics/evaluate",
        json={"period_start": "2026-08-01T00:00:00", "period_end": "2026-09-01T00:00:00"},
    )
    assert result.status_code == 200
    body = result.json()
    assert body["metrics"]["has_data"] is True
    assert body["rule"]["name"] == "6:3:1 baseline"
    assert {g["key"]: g["verdict"] for g in body["metrics"]["groups"]}["A"] == "pass"


async def test_evaluate_without_rule_returns_409(client):
    result = await client.post(
        "/api/analytics/evaluate",
        json={"period_start": "2026-08-01T00:00:00", "period_end": "2026-09-01T00:00:00"},
    )
    assert result.status_code == 409


async def test_unknown_rule_id_is_404_not_409(client):
    """409 means "you have no rule at all". Saying that to a client whose rule_id
    is merely typo'd sends them chasing a problem they do not have."""
    await _setup(client)
    result = await client.post(
        "/api/analytics/evaluate",
        json={
            "period_start": "2026-08-01T00:00:00",
            "period_end": "2026-09-01T00:00:00",
            "rule_id": 9999,
        },
    )
    assert result.status_code == 404


async def test_inverted_period_is_422_not_a_false_under(client):
    """A reversed range must not return 200 with every group "under" — that is
    indistinguishable from a month where nothing was logged."""
    await _setup(client)
    result = await client.post(
        "/api/analytics/evaluate",
        json={"period_start": "2026-09-01T00:00:00", "period_end": "2026-08-01T00:00:00"},
    )
    assert result.status_code == 422


async def test_evaluate_with_explicit_rule_id(client):
    await _setup(client)
    rule_id = (await client.get("/api/rules/active")).json()["id"]
    result = await client.post(
        "/api/analytics/evaluate",
        json={
            "period_start": "2026-08-01T00:00:00",
            "period_end": "2026-09-01T00:00:00",
            "rule_id": rule_id,
        },
    )
    assert result.status_code == 200
    assert result.json()["rule"]["id"] == rule_id
