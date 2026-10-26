"""AI-written analysis report through the Anthropic Messages API with tool use (stdlib only).

    export ANTHROPIC_API_KEY=...            # never commit it
    export PLATFORM_API=http://127.0.0.1:8080 PLATFORM_API_KEY=demo-school
    python ai_report.py --level school --unit R1-S1              # writes report_R1-S1.md
    python ai_report.py --level school --unit R1-S1 --dry-run    # prints the request, calls nothing

The model gets the same read-only tools as mcp_server.py; it never receives individual responses.
Swap call_model() to use another provider - the tool definitions are plain JSON Schema.
"""
from __future__ import annotations

import argparse
import json
import os
import urllib.request

from mcp_server import BY_NAME, TOOLS, call_api

MODEL = os.environ.get("AI_MODEL", "claude-sonnet-5-5")

SYSTEM = """Ти си аналитик на образователни данни. Пишеш на български, ясно и уважително, за родители и училищно ръководство.
Правила:
1. Първо извикай get_methodology и прочети бележките.
2. Използвай само числа, върнати от инструментите. Към всяка оценка давай интервала (lo–hi) и броя отговорили.
3. Разлика е съществена само ако интервалите не се припокриват (clear_difference) или категорията го показва.
4. Не твърди причинно-следствени връзки; пиши „свързано с“, не „причинено от“.
5. Оценките, които родителите и учениците съобщават, не са сравними между училища – използвай ги само за справедливост вътре в училището.
6. Не се опитвай да установиш кой е отговорил. Не цитирай отделни хора.
7. Структура: Резюме (3 изречения) · Силни страни · Тревожни области (с абсолютно ниво и сравнение) · Справедливост (пол, оценки) · Индикатори · Препоръки (3–5 конкретни, измерими) · Ограничения на данните."""


def call_model(messages: list, api_key: str) -> dict:
    body = {"model": MODEL, "max_tokens": 4000, "system": SYSTEM, "messages": messages,
            "tools": [{"name": t["name"], "description": t["description"], "input_schema": t["input_schema"]} for t in TOOLS]}
    req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=json.dumps(body).encode(), method="POST",
                                 headers={"x-api-key": api_key, "anthropic-version": "2023-06-01",
                                          "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode())


def run(level: str, unit: str, wave: str | None, dry: bool, max_turns: int = 12) -> str:
    ask = f"Направи анализ за {level} {unit}" + (f", вълна {wave}" if wave else "") + \
          ". Сравни със средното за системата и покажи тенденцията между вълните, ако има повече от една."
    messages = [{"role": "user", "content": ask}]
    if dry:
        return json.dumps({"model": MODEL, "system": SYSTEM, "messages": messages, "tools": [t["name"] for t in TOOLS]},
                          ensure_ascii=False, indent=1)
    key = os.environ["ANTHROPIC_API_KEY"]
    for _ in range(max_turns):
        resp = call_model(messages, key)
        messages.append({"role": "assistant", "content": resp["content"]})
        uses = [b for b in resp["content"] if b.get("type") == "tool_use"]
        if not uses:
            return "".join(b.get("text", "") for b in resp["content"] if b.get("type") == "text")
        results = []
        for u in uses:
            data = call_api(BY_NAME[u["name"]], u.get("input") or {})
            results.append({"type": "tool_result", "tool_use_id": u["id"],
                            "content": json.dumps(data, ensure_ascii=False)[:60000], "is_error": "error" in data})
        messages.append({"role": "user", "content": results})
    raise RuntimeError("tool loop did not finish")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--level", default="school")
    ap.add_argument("--unit", required=True)
    ap.add_argument("--wave")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    out = run(a.level, a.unit, a.wave, a.dry_run)
    if a.dry_run:
        print(out)
    else:
        path = f"report_{a.unit}.md"
        open(path, "w", encoding="utf-8").write(out)
        print("written", path)
