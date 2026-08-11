async def _tag(client, name="Reading", color="#8FA8A2", description=""):
    res = await client.post(
        "/api/tags",
        json={"name": name, "color": color, "description": description},
    )
    assert res.status_code == 201, res.text
    return res.json()


async def test_tag_round_trips_a_description(client):
    tag = await _tag(client, description="Books, papers, long-form")
    assert tag["description"] == "Books, papers, long-form"
    fetched = await client.get(f"/api/tags/{tag['id']}")
    assert fetched.json()["description"] == "Books, papers, long-form"


async def test_description_defaults_to_empty(client):
    res = await client.post("/api/tags", json={"name": "Plain", "color": "#DEDECF"})
    assert res.json()["description"] == ""


async def test_an_unused_tag_is_really_deleted(client):
    tag = await _tag(client, name="Unused")
    assert (await client.delete(f"/api/tags/{tag['id']}")).status_code == 204
    assert (await client.get(f"/api/tags/{tag['id']}")).status_code == 404


async def test_a_tag_in_use_refuses_deletion_and_says_how_many(client):
    tag = await _tag(client, name="Busy")
    for day in ("2026-08-03", "2026-08-04"):
        await client.post(
            "/api/events",
            json={
                "task_name": "Something",
                "start_at": f"{day}T09:00:00",
                "end_at": f"{day}T10:00:00",
                "tag_ids": [tag["id"]],
            },
        )
    refused = await client.delete(f"/api/tags/{tag['id']}")
    assert refused.status_code == 409
    # The count is the whole point: the UI shows it and offers archive instead.
    assert "2" in refused.json()["detail"]
    assert (await client.get(f"/api/tags/{tag['id']}")).status_code == 200


async def test_archive_is_still_available_on_its_own_route(client):
    tag = await _tag(client, name="Retired")
    archived = await client.post(f"/api/tags/{tag['id']}/archive")
    assert archived.status_code == 200
    assert archived.json()["archived"] is True
