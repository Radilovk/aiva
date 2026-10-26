"""MCP server (stdio, JSON-RPC 2.0) exposing the platform's read-only analysis tools to any MCP-capable AI client.

Configure, e.g. in an MCP client config:
    {"command": "python", "args": ["mcp_server.py"],
     "env": {"PLATFORM_API": "https://api.example.bg", "PLATFORM_API_KEY": "<scoped key>"}}

The key's scope decides what the model can see (public / researcher / school_admin / teacher).
Only aggregates are reachable; there is no tool that returns individual responses.
Stdlib only.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = json.load(open(os.path.join(HERE, "ai_tools.json"), encoding="utf-8"))["tools"]
BY_NAME = {t["name"]: t for t in TOOLS}
PROTOCOL = "2025-06-18"


def call_api(tool: dict, args: dict, base: str | None = None, key: str | None = None) -> dict:
    """Maps a tool call onto the HTTP API defined in ai_tools.json."""
    base = (base or os.environ.get("PLATFORM_API", "http://127.0.0.1:8080")).rstrip("/")
    key = key if key is not None else os.environ.get("PLATFORM_API_KEY", "")
    spec = tool["http"]
    path = spec["path"]
    for k, v in args.items():
        path = path.replace("{" + k + "}", urllib.parse.quote(str(v), safe=""))
    query = {k: args[k] for k in spec.get("query", []) if args.get(k) not in (None, "")}
    url = base + path + ("?" + urllib.parse.urlencode(query) if query else "")
    req = urllib.request.Request(url, method=spec["method"], headers={"X-API-Key": key})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return {"error": e.code, "detail": json.loads(e.read().decode() or "{}")}


def handle(msg: dict) -> dict | None:
    mid, method, params = msg.get("id"), msg.get("method"), msg.get("params") or {}
    if method == "initialize":
        result = {"protocolVersion": params.get("protocolVersion", PROTOCOL),
                  "capabilities": {"tools": {"listChanged": False}},
                  "serverInfo": {"name": "school-feedback", "version": "1.0.0"},
                  "instructions": "Read-only aggregates from the school feedback platform. Call get_methodology first. "
                                  "Report intervals, not just point scores; do not claim causes from correlations; "
                                  "never try to identify individual respondents."}
    elif method in ("notifications/initialized", "notifications/cancelled"):
        return None
    elif method == "ping":
        result = {}
    elif method == "tools/list":
        result = {"tools": [{"name": t["name"], "description": t["description"], "inputSchema": t["input_schema"]}
                            for t in TOOLS]}
    elif method == "tools/call":
        tool = BY_NAME.get(params.get("name"))
        if not tool:
            return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32602, "message": "unknown tool"}}
        data = call_api(tool, params.get("arguments") or {})
        result = {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False)}],
                  "isError": "error" in data}
    else:
        if mid is None:
            return None
        return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"method not found: {method}"}}
    return {"jsonrpc": "2.0", "id": mid, "result": result}


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            out = handle(json.loads(line))
        except Exception as ex:  # malformed input
            out = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": str(ex)}}
        if out is not None:
            sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
