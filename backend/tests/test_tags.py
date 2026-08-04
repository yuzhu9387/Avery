async def test_create_and_list_tag(client):
    created = await client.post(
        "/api/tags", json={"name": "Work", "color": "#DA96A4", "icon": "briefcase"}
    )
    assert created.status_code == 201
    body = created.json()
    assert body["name"] == "Work"
    assert body["color"] == "#DA96A4"
    assert body["archived"] is False

    listed = await client.get("/api/tags")
    assert listed.status_code == 200
    assert [t["name"] for t in listed.json()] == ["Work"]


async def test_duplicate_tag_name_rejected(client):
    await client.post("/api/tags", json={"name": "Work", "color": "#DA96A4"})
    dupe = await client.post("/api/tags", json={"name": "Work", "color": "#BDBD9B"})
    assert dupe.status_code == 409


async def test_update_and_archive_tag(client):
    tag_id = (
        await client.post("/api/tags", json={"name": "Study", "color": "#8FA8A2"})
    ).json()["id"]

    patched = await client.patch(f"/api/tags/{tag_id}", json={"color": "#BDBD9B"})
    assert patched.status_code == 200
    assert patched.json()["color"] == "#BDBD9B"

    archived = await client.delete(f"/api/tags/{tag_id}")
    assert archived.status_code == 200
    assert archived.json()["archived"] is True


async def test_archived_tag_stays_resolvable_by_id(client):
    """Events freeze tag ids onto themselves, so an archived tag must stay readable."""
    tag_id = (
        await client.post("/api/tags", json={"name": "Old", "color": "#DEDECF"})
    ).json()["id"]
    await client.delete(f"/api/tags/{tag_id}")

    fetched = await client.get(f"/api/tags/{tag_id}")
    assert fetched.status_code == 200
    assert fetched.json()["archived"] is True


async def test_archived_tags_hidden_from_list_by_default(client):
    keep = (
        await client.post("/api/tags", json={"name": "Keep", "color": "#BDBD9B"})
    ).json()["id"]
    drop = (
        await client.post("/api/tags", json={"name": "Drop", "color": "#DA96A4"})
    ).json()["id"]
    await client.delete(f"/api/tags/{drop}")

    assert [t["id"] for t in (await client.get("/api/tags")).json()] == [keep]

    everything = await client.get("/api/tags", params={"include_archived": True})
    assert {t["id"] for t in everything.json()} == {keep, drop}


async def test_archiving_is_idempotent(client):
    tag_id = (
        await client.post("/api/tags", json={"name": "Twice", "color": "#C9A88F"})
    ).json()["id"]
    assert (await client.delete(f"/api/tags/{tag_id}")).status_code == 200
    assert (await client.delete(f"/api/tags/{tag_id}")).status_code == 200


async def test_archive_missing_tag_returns_404(client):
    assert (await client.delete("/api/tags/999")).status_code == 404


async def test_archived_name_still_blocks_duplicates(client):
    """Archived rows keep occupying the unique index — re-creating the name must 409."""
    tag_id = (
        await client.post("/api/tags", json={"name": "Work", "color": "#DA96A4"})
    ).json()["id"]
    await client.delete(f"/api/tags/{tag_id}")

    dupe = await client.post("/api/tags", json={"name": "Work", "color": "#BDBD9B"})
    assert dupe.status_code == 409
