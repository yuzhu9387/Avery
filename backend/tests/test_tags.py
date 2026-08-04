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


async def test_update_and_delete_tag(client):
    tag_id = (
        await client.post("/api/tags", json={"name": "Study", "color": "#8FA8A2"})
    ).json()["id"]

    patched = await client.patch(f"/api/tags/{tag_id}", json={"color": "#BDBD9B"})
    assert patched.status_code == 200
    assert patched.json()["color"] == "#BDBD9B"

    deleted = await client.delete(f"/api/tags/{tag_id}")
    assert deleted.status_code == 204
    assert (await client.get(f"/api/tags/{tag_id}")).status_code == 404


async def test_delete_missing_tag_returns_404(client):
    assert (await client.delete("/api/tags/999")).status_code == 404
