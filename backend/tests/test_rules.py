from datetime import date

RULE_BODY = {
    "name": "6:3:1 baseline",
    "tolerance": 0.2,
    "exclude_tag_ids": [1, 8],
    "groups": [
        {"key": "A", "label": "Work · Study · Commute", "ratio": 6, "tag_ids": [2, 3, 4]},
        {"key": "B", "label": "Kids · Chores", "ratio": 3, "tag_ids": [5, 6]},
        {"key": "C", "label": "Fitness", "ratio": 1, "tag_ids": [7]},
    ],
    "note": "initial commitment",
}


async def _seed_tags(client, count=8):
    """RULE_BODY references tag ids 1..count; back them with real Tag rows so
    F7's assert_tags_exist does not reject every rule test as an unknown tag id."""
    for i in range(count):
        await client.post("/api/tags", json={"name": f"Tag{i + 1}", "color": "#DA96A4"})


async def test_create_rule_is_active(client):
    await _seed_tags(client)
    created = await client.post("/api/rules", json=RULE_BODY)
    assert created.status_code == 201
    assert created.json()["effective_to"] is None

    active = await client.get("/api/rules/active")
    assert active.json()["name"] == "6:3:1 baseline"


async def test_new_version_closes_previous(client):
    await _seed_tags(client)
    first_id = (await client.post("/api/rules", json=RULE_BODY)).json()["id"]

    loosened = {**RULE_BODY, "name": "6:3:1 loosened", "tolerance": 0.3, "note": "fitness hard"}
    second = await client.post("/api/rules", json=loosened)
    assert second.status_code == 201

    first = (await client.get(f"/api/rules/{first_id}")).json()
    assert first["effective_to"] == date.today().isoformat()
    assert second.json()["effective_to"] is None

    active = await client.get("/api/rules/active")
    assert active.json()["id"] == second.json()["id"]


async def test_rules_are_never_mutated_in_place(client):
    await _seed_tags(client)
    await client.post("/api/rules", json=RULE_BODY)
    # There is deliberately no PATCH route on rules.
    assert (await client.patch("/api/rules/1", json={"tolerance": 0.9})).status_code == 405


async def test_ratios_must_be_positive(client):
    bad = {**RULE_BODY, "groups": [{**RULE_BODY["groups"][0], "ratio": 0}]}
    assert (await client.post("/api/rules", json=bad)).status_code == 422


async def test_active_rule_404_when_none(client):
    assert (await client.get("/api/rules/active")).status_code == 404


async def test_tag_in_group_and_excluded_is_422(client):
    """Exclusion wins in analytics.py, so a tag caught in both leaves the ratio's
    denominator entirely — the group that references it silently loses minutes."""
    await _seed_tags(client)
    bad = {**RULE_BODY, "exclude_tag_ids": [1, 2]}  # tag 2 is also in group A
    assert (await client.post("/api/rules", json=bad)).status_code == 422


async def test_tag_in_two_groups_is_422(client):
    """tag_to_group is a dict comprehension in analytics.py, so the last group
    wins silently — the earlier group's share is understated with no error."""
    await _seed_tags(client)
    bad = {
        **RULE_BODY,
        "groups": [
            {"key": "A", "label": "Work", "ratio": 6, "tag_ids": [2, 3]},
            {"key": "B", "label": "Kids", "ratio": 3, "tag_ids": [3, 5]},  # tag 3 dupes
        ],
    }
    assert (await client.post("/api/rules", json=bad)).status_code == 422


async def test_duplicate_group_keys_is_422(client):
    """minutes_by_group collapses same-key groups, so the payload emits two rows
    both claiming the same minutes and share_actual sums to more than 1.0."""
    await _seed_tags(client)
    bad = {
        **RULE_BODY,
        "groups": [
            {"key": "A", "label": "Work", "ratio": 6, "tag_ids": [2]},
            {"key": "A", "label": "Duplicate key", "ratio": 3, "tag_ids": [5]},
        ],
    }
    assert (await client.post("/api/rules", json=bad)).status_code == 422


async def test_unknown_tag_id_in_rule_is_422(client):
    """No FK backs these JSON arrays; a typo'd tag id would otherwise pin a group
    at 0 minutes/under forever with no explanation."""
    await _seed_tags(client, count=7)  # tag id 8 deliberately left unseeded
    assert (await client.post("/api/rules", json=RULE_BODY)).status_code == 422


async def test_archived_tag_id_in_rule_is_still_accepted(client):
    """Archived tags count as existing — they are still real rows events point at."""
    await _seed_tags(client)
    tags = (await client.get("/api/tags", params={"include_archived": True})).json()
    tag_8 = next(t["id"] for t in tags if t["name"] == "Tag8")
    await client.delete(f"/api/tags/{tag_8}")  # archives, does not remove the row

    assert (await client.post("/api/rules", json=RULE_BODY)).status_code == 201
