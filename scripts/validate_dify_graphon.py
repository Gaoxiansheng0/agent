"""Validate a flow-forge Dify DSL against Dify's own node models (graphon) and dry-run it.

Needs Python 3.12 with graphon installed (the package Dify 1.18.0 pins):
    uv venv -p 3.12 .venv-graphon
    uv pip install -p .venv-graphon "graphon @ git+https://github.com/langgenius/graphon@4fa22141774dff80e90e4dfa98ea3e6fbf0421bb" pyyaml
    .venv-graphon/Scripts/python scripts/validate_dify_graphon.py out/sample.dify.yml

Checks:
1. Envelope: version / kind / app.mode, the same fields app_dsl_service.import_app reads.
2. Every node's data validates with graphon's StartNodeData / CodeNodeData /
   HttpRequestNodeData / EndNodeData.
3. Edges, value selectors and {{#...#}} templates point at existing nodes, declared
   outputs or environment variables, using graphon's own template regex.
4. Dry run: executes each code node's main() in order, with HTTP responses mocked from
   the request URL, and checks declared outputs are returned with the right types.
No network calls are made.
"""

import json
import re
import sys

import yaml
from graphon.nodes.base.variable_template_parser import REGEX
from graphon.nodes.code.entities import CodeNodeData
from graphon.nodes.end.entities import EndNodeData
from graphon.nodes.http_request.entities import HttpRequestNodeData
from graphon.nodes.start.entities import StartNodeData

MODELS = {
    "start": StartNodeData,
    "code": CodeNodeData,
    "http-request": HttpRequestNodeData,
    "end": EndNodeData,
}
HTTP_OUTPUTS = {"body", "status_code", "headers", "files"}

# Response shapes per vendor, as documented; only the fields the workflow reads.
MOCKS = [
    ("images/generations", {"data": [{"url": "https://mock/image.png"}]}),
    ("contents/generations/tasks", {"id": "ark-task-1"}),
    ("klingai.com", {"code": 0, "data": {"id": "kling-task-1", "status": "submitted"}}),
    ("video_generation", {"task_id": "minimax-task-1"}),
    ("t2a_v2", {"data": {"audio": "https://mock/voice.mp3"}}),
    ("runwayml.com", {"id": "runway-task-1"}),
    ("vidu.cn", {"task_id": "vidu-task-1", "state": "created"}),
]
TYPE_CHECKS = {
    "string": str,
    "number": (int, float),
    "object": dict,
    "array[object]": list,
}


def fail(msg):
    print(f"FAIL: {msg}")
    sys.exit(1)


def main(path):
    with open(path, encoding="utf-8") as f:
        dsl = yaml.safe_load(f)
    if dsl.get("version") != "0.7.0" or dsl.get("kind") != "app":
        fail("version must be 0.7.0 and kind app")
    if dsl["app"].get("mode") != "workflow":
        fail("app.mode must be workflow")
    wf = dsl["workflow"]
    env = {v["name"] for v in wf["environment_variables"]}
    for v in wf["environment_variables"]:
        if v["value_type"] not in ("secret", "string") or v.get("value") is None:
            fail(f"env {v['name']} needs value_type and a non-null value")
    nodes = wf["graph"]["nodes"]
    by_id = {n["id"]: n for n in nodes}
    if len(by_id) != len(nodes):
        fail("duplicate node ids")
    outputs = {}
    for n in nodes:
        d = n["data"]
        model = MODELS.get(d["type"])
        if not model:
            fail(f"{n['id']}: unexpected node type {d['type']}")
        model.model_validate(d)
        if n.get("type") != "custom" or "position" not in n:
            fail(f"{n['id']}: canvas fields missing")
        if d["type"] == "start":
            outputs[n["id"]] = {v["variable"] for v in d["variables"]}
        elif d["type"] == "code":
            outputs[n["id"]] = set(d["outputs"])
        elif d["type"] == "http-request":
            outputs[n["id"]] = HTTP_OUTPUTS
        else:
            outputs[n["id"]] = set()
    starts = [n for n in nodes if n["data"]["type"] == "start"]
    ends = [n for n in nodes if n["data"]["type"] == "end"]
    if len(starts) != 1 or len(ends) != 1:
        fail("need exactly one start and one end node")

    def check_selector(owner, sel):
        if sel[0] == "env":
            if sel[1] not in env:
                fail(f"{owner}: unknown env {sel[1]}")
            return
        if sel[0] not in by_id:
            fail(f"{owner}: selector points at missing node {sel[0]}")
        if sel[1] not in outputs[sel[0]]:
            fail(f"{owner}: node {sel[0]} has no output {sel[1]}")

    edges = wf["graph"]["edges"]
    incoming = {n["id"]: 0 for n in nodes}
    for e in edges:
        if e["source"] not in by_id or e["target"] not in by_id:
            fail(f"edge {e['id']} points at a missing node")
        if e["data"]["sourceType"] != by_id[e["source"]]["data"]["type"]:
            fail(f"edge {e['id']} sourceType mismatch")
        if e["data"]["targetType"] != by_id[e["target"]]["data"]["type"]:
            fail(f"edge {e['id']} targetType mismatch")
        incoming[e["target"]] += 1
    for nid, count in incoming.items():
        if nid != starts[0]["id"] and count == 0:
            fail(f"{nid} is not connected")

    order = topo(nodes, edges)
    for n in nodes:
        d = n["data"]
        for v in d.get("variables", []) if d["type"] == "code" else []:
            check_selector(n["id"], v["value_selector"])
        for o in d.get("outputs", []) if d["type"] == "end" else []:
            check_selector(n["id"], o["value_selector"])
        if d["type"] == "http-request":
            texts = [d["url"], d["headers"]] + [b["value"] for b in d["body"]["data"]]
            for t in texts:
                for m in re.finditer(REGEX, t):
                    sel = m.group(1).strip("#").split(".")
                    check_selector(n["id"], sel)
                if "{{" in t and not re.search(REGEX, t):
                    fail(f"{n['id']}: template not recognised by graphon: {t[:80]}")
        # A node may only read nodes that run before it.
        for sel in selectors(d):
            if sel[0] != "env" and order.index(sel[0]) >= order.index(n["id"]):
                fail(f"{n['id']} reads {sel[0]} which runs later")

    # Dry run
    values = {starts[0]["id"]: {"bgm_url": ""}}
    for nid in order:
        d = by_id[nid]["data"]
        if d["type"] == "code":
            scope = {}
            exec(compile(d["code"], nid, "exec"), scope)
            args = {v["variable"]: values[v["value_selector"][0]][v["value_selector"][1]] for v in d["variables"]}
            result = scope["main"](**args)
            for name, spec in d["outputs"].items():
                if name not in result:
                    fail(f"{nid}: main() did not return {name}")
                if not isinstance(result[name], TYPE_CHECKS[spec["type"]]):
                    fail(f"{nid}: output {name} is {type(result[name]).__name__}, declared {spec['type']}")
            values[nid] = result
        elif d["type"] == "http-request":
            raw = d["body"]["data"][0]["value"]
            sel = re.search(REGEX, raw).group(1).strip("#").split(".")
            body = values[sel[0]][sel[1]]
            json.loads(body)  # the request body must be valid JSON
            mock = next((m for key, m in MOCKS if key in d["url"]), None)
            if mock is None:
                fail(f"{nid}: no mock for {d['url']}")
            values[nid] = {"body": json.dumps(mock), "status_code": 200, "headers": "{}", "files": []}
    timeline = json.loads(values["compose"]["timeline_json"])
    if not timeline["clips"]:
        fail("timeline has no clips")
    http = sum(1 for n in nodes if n["data"]["type"] == "http-request")
    print(f"OK: {len(nodes)} nodes ({http} HTTP), {len(edges)} edges, {len(timeline['clips'])} clips, env {sorted(env)}")
    for c in timeline["clips"]:
        print(f"  {c['segment']:>6} {c['start']:>3}s +{c['duration']}s task={c['task'] or '-'} voice={c['voice']}")


def selectors(d):
    if d["type"] == "code":
        return [v["value_selector"] for v in d["variables"]]
    if d["type"] == "end":
        return [o["value_selector"] for o in d["outputs"]]
    if d["type"] == "http-request":
        texts = [d["url"], d["headers"]] + [b["value"] for b in d["body"]["data"]]
        return [m.group(1).strip("#").split(".") for t in texts for m in re.finditer(REGEX, t)]
    return []


def topo(nodes, edges):
    nxt = {}
    for e in edges:
        nxt.setdefault(e["source"], []).append(e["target"])
    indeg = {n["id"]: 0 for n in nodes}
    for e in edges:
        indeg[e["target"]] += 1
    queue = [k for k, v in indeg.items() if v == 0]
    order = []
    while queue:
        k = queue.pop(0)
        order.append(k)
        for t in nxt.get(k, []):
            indeg[t] -= 1
            if indeg[t] == 0:
                queue.append(t)
    if len(order) != len(nodes):
        fail("graph has a cycle")
    return order


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "out/sample.dify.yml")
