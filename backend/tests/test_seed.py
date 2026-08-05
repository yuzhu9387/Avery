async def test_seed_creates_tags_rule_and_template(client):
    result = await client.post("/api/seed")
    assert result.status_code == 200
    body = result.json()
    assert body["tags"] == 8
    assert body["rules"] == 1
    assert body["templates"] == 1

    tags = (await client.get("/api/tags")).json()
    assert [t["name"] for t in tags] == [
        "Rest", "Work", "Study", "Commute",
        "Kids/Family", "Chores/Prep", "Fitness", "Personal",
    ]


async def test_seeded_rule_is_631_with_rest_and_personal_excluded(client):
    await client.post("/api/seed")
    rule = (await client.get("/api/rules/active")).json()
    assert rule["tolerance"] == 0.2
    assert [g["ratio"] for g in rule["groups"]] == [6, 3, 1]

    tags = {t["name"]: t["id"] for t in (await client.get("/api/tags")).json()}
    assert set(rule["exclude_tag_ids"]) == {tags["Rest"], tags["Personal"]}
    assert set(rule["groups"][0]["tag_ids"]) == {tags["Work"], tags["Study"], tags["Commute"]}
    assert set(rule["groups"][2]["tag_ids"]) == {tags["Fitness"]}


async def test_seed_is_idempotent(client):
    await client.post("/api/seed")
    second = (await client.post("/api/seed")).json()
    assert second == {"tags": 0, "rules": 0, "templates": 0}
    assert len((await client.get("/api/tags")).json()) == 8
    assert len((await client.get("/api/rules")).json()) == 1


async def test_seeded_template_matches_the_source_grid(client):
    await client.post("/api/seed")
    template = (await client.get("/api/templates/active")).json()
    blocks = template["blocks"]

    weekday_work = next(
        b for b in blocks if b["task_name"] == "Work" and b["days"] == [1, 2, 3, 4, 5]
    )
    assert weekday_work["start_time"] == "09:30:00"
    assert weekday_work["end_time"] == "16:30:00"

    rest = next(b for b in blocks if b["task_name"] == "Rest")
    assert rest["days"] == [1, 2, 3, 4, 5, 6, 7]
    assert rest["start_time"] == "23:00:00"
    assert rest["end_time"] == "07:00:00"

    assert any(b["task_name"] == "Baby food prep" and b["days"] == [7] for b in blocks)
    assert any(b["task_name"] == "Personal time" and b["days"] == [6] for b in blocks)


async def test_seeded_week_materializes_and_matches_631_shape(client):
    """Seed, materialize a week, and confirm the analytics engine reads it as the spec predicts."""
    await client.post("/api/seed")
    await client.post("/api/weeks/2026-08-03/materialize")

    result = await client.post(
        "/api/analytics/evaluate",
        json={"period_start": "2026-08-03T00:00:00", "period_end": "2026-08-08T00:00:00"},
    )
    verdicts = {g["key"]: g["verdict"] for g in result.json()["metrics"]["groups"]}
    assert verdicts["A"] == "pass"
    assert verdicts["B"] == "pass"
    assert verdicts["C"] == "under"
