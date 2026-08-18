"""avery_tags against a mocked Avery HTTP layer."""

import httpx
import pytest

import mcp_server.shared as shared_mod
from mcp_server.client import AveryClient


@pytest.fixture(autouse=True)
def _reset_client():
    shared_mod._client = None
    yield
    shared_mod._client = None


def _install(handler) -> list:
    calls: list[tuple[str, str, object]] = []

    def _recording(request: httpx.Request):
        body = None
        if request.content:
            import json as _json
            body = _json.loads(request.content)
        calls.append((request.method, request.url.path, body))
        return handler(request)

    shared_mod._client = AveryClient(
        base_url="http://test", token="t", transport=httpx.MockTransport(_recording)
    )
    return calls


from mcp_server.tools.tags import avery_tags


def _tag(**over) -> dict:
    base = {"id": 1, "name": "Work", "color": "#AA5566", "description": "",
            "icon": None, "sort_order": 0, "archived": False}
    base.update(over)
    return base


async def test_create_requires_name_and_color():
    calls = _install(lambda r: httpx.Response(201, json=_tag()))
    await avery_tags(action="create", name="Work", color="#AA5566")
    assert calls[0][:2] == ("POST", "/api/tags")
    assert calls[0][2] == {"name": "Work", "color": "#AA5566"}


async def test_delete_in_use_surfaces_avery_s_count_verbatim():
    """Avery 409s with a count when the category is still referenced. That
    sentence is what lets the model offer archiving instead, so it must reach
    the model unedited."""
    _install(lambda r: httpx.Response(409, json={"detail": "12 event(s) still use this category"}))
    with pytest.raises(Exception, match="12 event"):
        await avery_tags(action="delete", tag_id=1)


async def test_archive_posts_to_the_archive_route():
    calls = _install(lambda r: httpx.Response(200, json=_tag(archived=True)))
    await avery_tags(action="archive", tag_id=1)
    assert calls[0][:2] == ("POST", "/api/tags/1/archive")


async def test_delete_returns_a_confirmation():
    calls = _install(lambda r: httpx.Response(204))
    result = await avery_tags(action="delete", tag_id=2)
    assert calls[0][:2] == ("DELETE", "/api/tags/2")
    assert result == {"deleted": 2}


async def test_update_omits_unset_fields():
    calls = _install(lambda r: httpx.Response(200, json=_tag(name="Deep work")))
    await avery_tags(action="update", tag_id=1, name="Deep work")
    assert calls[0][2] == {"name": "Deep work"}
