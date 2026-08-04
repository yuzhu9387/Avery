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


async def test_create_rule_is_active(client):
    created = await client.post("/api/rules", json=RULE_BODY)
    assert created.status_code == 201
    assert created.json()["effective_to"] is None

    active = await client.get("/api/rules/active")
    assert active.json()["name"] == "6:3:1 baseline"


async def test_new_version_closes_previous(client):
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
    await client.post("/api/rules", json=RULE_BODY)
    # There is deliberately no PATCH route on rules.
    assert (await client.patch("/api/rules/1", json={"tolerance": 0.9})).status_code == 405


async def test_ratios_must_be_positive(client):
    bad = {**RULE_BODY, "groups": [{**RULE_BODY["groups"][0], "ratio": 0}]}
    assert (await client.post("/api/rules", json=bad)).status_code == 422


async def test_active_rule_404_when_none(client):
    assert (await client.get("/api/rules/active")).status_code == 404
