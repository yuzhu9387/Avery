"""avery_rules against a mocked Avery HTTP layer."""

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


from mcp_server.tools.rules import avery_rules

_GROUPS = [
    {"key": "work", "label": "Work & Study", "ratio": 6, "tag_ids": [2, 3]},
    {"key": "family", "label": "Family care", "ratio": 3, "tag_ids": [5]},
    {"key": "fit", "label": "Fitness", "ratio": 1, "tag_ids": [7]},
]


async def test_create_sends_groups_and_tolerance():
    calls = _install(lambda r: httpx.Response(201, json={"id": 1}))
    await avery_rules(action="create", name="6:3:1", groups=_GROUPS, tolerance=0.2)
    assert calls[0][:2] == ("POST", "/api/rules")
    assert calls[0][2] == {"name": "6:3:1", "groups": _GROUPS, "tolerance": 0.2}


async def test_update_omits_unset_fields():
    calls = _install(lambda r: httpx.Response(200, json={"id": 2}))
    await avery_rules(action="update", rule_id=1, tolerance=0.1)
    assert calls[0][2] == {"tolerance": 0.1}


async def test_active_hits_the_active_route_not_an_id():
    calls = _install(lambda r: httpx.Response(200, json={"id": 1}))
    await avery_rules(action="active")
    assert calls[0][:2] == ("GET", "/api/rules/active")


async def test_delete_referenced_by_a_report_surfaces_the_409():
    _install(lambda r: httpx.Response(409, json={"detail": "a report references this rule"}))
    with pytest.raises(Exception, match="report references"):
        await avery_rules(action="delete", rule_id=1)
