import asyncio
import json

import httpx
import pytest

from app.providers import Draft, MAX_RESPONSE_BYTES, ProviderError, generate_draft


OPTIONS = {
    "mode": "openai_compatible",
    "endpoint": "https://gateway.example.test/v1/",
    "model": "test-model",
    "timeout_seconds": 1,
    "max_tokens": 660,
    "api_key": "fixture-upstream-test-value",
}
GOOD_DRAFT = {"title": "待审核草稿", "summary": "基于虚构商品。", "sections": [{"heading": "方案", "items": ["核查输入。"]}]}


def _completion(content=GOOD_DRAFT, *, finish="stop", message_extras=None):
    return {
        "choices": [{
            "finish_reason": finish,
            "message": {"role": "assistant", "content": json.dumps(content), **(message_extras or {})},
        }],
    }


def _generate(handler=None, *, agent="creator", context="旅行收纳袋，待审核", **overrides):
    config = {**OPTIONS, **overrides}
    if handler is not None:
        config["transport"] = httpx.MockTransport(handler)
    return asyncio.run(generate_draft(agent, context, **config))


def test_mock_is_deterministic_and_role_specific():
    def unexpected_request(request):
        pytest.fail("Mock mode must remain offline")

    first = _generate(unexpected_request, mode="mock", api_key="")
    again = _generate(unexpected_request, mode="mock", api_key="")
    ads = _generate(unexpected_request, agent="ads", mode="mock", api_key="")
    assert first == again
    assert first.title.startswith("Mock 模拟")
    assert ads.title != first.title
    assert isinstance(first, Draft)


def test_chat_adapter_sends_text_only_and_returns_validated_draft():
    def handler(request):
        assert str(request.url) == "https://gateway.example.test/v1/chat/completions"
        assert request.method == "POST"
        assert request.headers["Authorization"] == f"Bearer {OPTIONS['api_key']}"
        assert request.headers["Accept-Encoding"] == "identity"
        payload = json.loads(request.content)
        assert set(payload) == {"model", "messages", "max_tokens", "stream"}
        assert payload["model"] == OPTIONS["model"]
        assert payload["stream"] is False
        assert payload["max_tokens"] == OPTIONS["max_tokens"]
        assert payload["messages"][1] == {"role": "user", "content": "旅行收纳袋，待审核"}
        assert "storyboard" in payload["messages"][0]["content"]
        assert OPTIONS["api_key"] not in request.content.decode()
        return httpx.Response(200, json=_completion())

    assert _generate(handler).model_dump() == GOOD_DRAFT


@pytest.mark.parametrize(
    "payload",
    [
        {"choices": []},
        _completion({"title": " ", "summary": "s", "sections": [{"heading": "h", "items": ["i"]}]}),
        _completion({"title": "title", "summary": 1, "sections": []}),
        _completion({"title": "title", "summary": "s", "sections": [{"heading": "h", "items": [42]}]}),
        _completion({**GOOD_DRAFT, "execute": True}),
        _completion(finish="length"),
        _completion(message_extras={"tool_calls": [{"id": "private-example"}]}),
        _completion(message_extras={"content": "```json\n{}\n```"}),
    ],
)
def test_invalid_or_nontext_completion_fails_without_mock_fallback(payload):
    with pytest.raises(ProviderError) as error:
        _generate(lambda request: httpx.Response(200, json=payload))
    assert error.value.code == "invalid_response"
    assert "完整 JSON" in str(error.value)
    assert "private-example" not in str(error.value)


def test_redirect_is_not_followed_and_upstream_errors_hide_body():
    requests = []

    def redirect(request):
        requests.append(request.url.host)
        return httpx.Response(302, headers={"Location": "https://unapproved.example.test/"}, text=OPTIONS["api_key"])

    with pytest.raises(ProviderError, match="已停止请求") as error:
        _generate(redirect)
    assert requests == ["gateway.example.test"]
    assert OPTIONS["api_key"] not in str(error.value)
    with pytest.raises(ProviderError, match="拒绝凭据") as error:
        _generate(lambda request: httpx.Response(401, text=f"debug: {OPTIONS['api_key']}"))
    assert error.value.code == "rejected"
    assert OPTIONS["api_key"] not in str(error.value)


def test_response_and_context_cannot_echo_configured_secret():
    secret = OPTIONS["api_key"]

    def unexpected_request(request):
        pytest.fail("secret in context must be blocked before the request")

    with pytest.raises(ProviderError) as error:
        _generate(unexpected_request, context=f"forbidden {secret}")
    assert error.value.code == "configuration"
    assert secret not in str(error.value)
    with pytest.raises(ProviderError, match="受保护值") as error:
        _generate(lambda request: httpx.Response(200, json=_completion({**GOOD_DRAFT, "summary": f"echo {secret}"})))
    assert error.value.code == "invalid_response"
    assert secret not in str(error.value)


def test_timeout_and_transport_errors_are_sanitized():
    async def delayed(request):
        await asyncio.sleep(1.2)
        return httpx.Response(200, json=_completion())

    def disconnected(request):
        raise httpx.ConnectError(f"private debug {OPTIONS['api_key']}", request=request)

    with pytest.raises(ProviderError) as error:
        _generate(delayed)
    assert error.value.code == "timeout"
    with pytest.raises(ProviderError) as error:
        _generate(disconnected)
    assert error.value.code == "unreachable"
    assert OPTIONS["api_key"] not in str(error.value)


def test_oversize_and_non_https_fail():
    with pytest.raises(ProviderError, match="超过大小限制"):
        _generate(lambda request: httpx.Response(200, content=b" " * (MAX_RESPONSE_BYTES + 1)))
    with pytest.raises(ProviderError, match="HTTPS"):
        _generate(lambda request: pytest.fail("invalid endpoint reached transport"), endpoint="http://gateway.example.test")
