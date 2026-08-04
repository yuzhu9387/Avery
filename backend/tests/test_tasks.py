async def _tag(client, name="Work", color="#DA96A4"):
    return (await client.post("/api/tags", json={"name": name, "color": color})).json()["id"]


async def test_create_task_defaults(client):
    tag_id = await _tag(client)
    created = await client.post(
        "/api/tasks", json={"name": "Morning routine", "tag_ids": [tag_id]}
    )
    assert created.status_code == 201
    body = created.json()
    assert body["status"] == "todo"
    assert body["priority"] == "normal"
    assert body["is_floating"] is False
    assert body["tag_ids"] == [tag_id]
    assert body["completed_at"] is None


async def test_floating_task_filter(client):
    await client.post("/api/tasks", json={"name": "Scheduled", "tag_ids": []})
    await client.post(
        "/api/tasks", json={"name": "Renew passport", "tag_ids": [], "is_floating": True}
    )
    floating = await client.get("/api/tasks", params={"is_floating": True})
    assert [t["name"] for t in floating.json()] == ["Renew passport"]


async def test_completing_task_stamps_completed_at(client):
    task_id = (await client.post("/api/tasks", json={"name": "Gym", "tag_ids": []})).json()["id"]
    patched = await client.patch(f"/api/tasks/{task_id}", json={"status": "done"})
    assert patched.status_code == 200
    assert patched.json()["completed_at"] is not None


async def test_reopening_task_clears_completed_at(client):
    task_id = (await client.post("/api/tasks", json={"name": "Gym", "tag_ids": []})).json()["id"]
    await client.patch(f"/api/tasks/{task_id}", json={"status": "done"})
    reopened = await client.patch(f"/api/tasks/{task_id}", json={"status": "todo"})
    assert reopened.json()["completed_at"] is None


async def test_delete_task(client):
    task_id = (await client.post("/api/tasks", json={"name": "Temp", "tag_ids": []})).json()["id"]
    assert (await client.delete(f"/api/tasks/{task_id}")).status_code == 204
    assert (await client.get(f"/api/tasks/{task_id}")).status_code == 404
