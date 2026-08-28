#!/usr/bin/env python3
"""Create and verify fail-closed adversarial-review evidence bundles."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets
import stat
import subprocess
import sys
from pathlib import Path
from typing import Any

ZERO_HASH = "0" * 64
SCHEMA = 1


def canonical(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True,
                       separators=(",", ":"))).encode("utf-8")


def digest_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def digest_object(value: dict[str, Any], field: str) -> str:
    body = {key: item for key, item in value.items() if key != field}
    return digest_bytes(canonical(body))


def digest_manifest(value: dict[str, Any]) -> str:
    body = {key: item for key, item in value.items() if key != "manifest_sha256"}
    return digest_bytes(canonical(body))


def snapshot_content_digest(value: dict[str, Any]) -> str:
    body = {key: item for key, item in value.items()
            if key not in {"snapshot_sha256", "evidence_manifest_sha256"}}
    return digest_bytes(canonical(body))


def read_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def write_json(path: Path, value: dict[str, Any], hash_field: str | None = None) -> str | None:
    value = dict(value)
    if hash_field:
        value[hash_field] = digest_object(value, hash_field)
    path.write_bytes(canonical(value))
    return value.get(hash_field) if hash_field else None


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def path_classification(root: Path, relative: str) -> dict[str, Any]:
    def git_check(*args: str) -> bool:
        try:
            subprocess.run(["git", "-C", str(root), *args, "--", relative],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return True
        except OSError as error:
            raise ValueError(f"cannot classify scope path {relative}: {error}") from error
        except subprocess.CalledProcessError:
            return False
    tracked = git_check("ls-files", "--error-unmatch")
    ignored = git_check("check-ignore", "--quiet")
    generated = ignored or any(part in {"dist", "build", "target", "coverage", ".cache", "node_modules"}
                               for part in Path(relative).parts)
    submodule = False
    try:
        result = subprocess.run(["git", "-C", str(root), "ls-files", "--stage", "--", relative],
                                check=False, capture_output=True, text=True)
        submodule = any(line.split(" ", 1)[0] == "160000" for line in result.stdout.splitlines())
    except OSError:
        pass
    return {"tracked": tracked, "ignored": ignored, "generated": generated, "submodule": submodule}


def scan_tree(root: Path, run_dir: Path) -> dict[str, Any]:
    entries: list[dict[str, Any]] = []
    run_relative = run_dir.relative_to(root) if run_dir.is_relative_to(root) else None
    for current, dirs, files in os.walk(root, followlinks=False):
        current_path = Path(current)
        dirs[:] = sorted(dirs)
        files = sorted(files)
        for name in dirs + files:
            path = current_path / name
            relative = path.relative_to(root).as_posix()
            if run_relative and (relative == run_relative.as_posix() or relative.startswith(run_relative.as_posix() + "/")):
                continue
            info = path.lstat()
            item: dict[str, Any] = {
                "mode": stat.S_IMODE(info.st_mode),
                "path": relative,
                "type": "directory" if path.is_dir() and not path.is_symlink() else "file",
            }
            item.update(path_classification(root, relative))
            if path.is_symlink():
                item["type"] = "symlink"
                item["target"] = os.readlink(path)
            elif path.is_file():
                item["sha256"] = file_hash(path)
            entries.append(item)
    entries.sort(key=lambda item: item["path"].encode("utf-8"))
    return {"schema_version": SCHEMA, "entries": entries}


def repository_state(root: Path) -> dict[str, Any]:
    def run(*args: str) -> list[str]:
        result = subprocess.run(["git", "-C", str(root), *args], check=True,
                                capture_output=True, text=True)
        return sorted(line for line in result.stdout.splitlines() if line)
    try:
        return {"revision": run("rev-parse", "HEAD")[0],
                "status": run("status", "--porcelain=v1", "--untracked-files=all"),
                "ignored": run("status", "--porcelain=v1", "--ignored", "--untracked-files=all"),
                "submodules": run("submodule", "status"),
                "generated": [], "diff": run("diff", "--no-ext-diff", "--binary")}
    except (OSError, subprocess.CalledProcessError):
        raise ValueError("target scope is not a readable Git worktree")


def scan_identity(scan: dict[str, Any]) -> str:
    return digest_bytes(canonical(scan))


def verify_hashed_json(path: Path, field: str) -> dict[str, Any]:
    value = read_json(path)
    actual = value.get(field)
    expected = digest_object(value, field)
    if actual != expected:
        raise ValueError(f"{path.name}: invalid {field}")
    return value


def _acceptance_ids(snapshot: dict[str, Any]) -> list[str]:
    matrix = snapshot.get("acceptance_matrix", {})
    if isinstance(matrix, dict) and isinstance(matrix.get("item_ids"), list):
        return sorted(matrix["item_ids"])
    criteria = snapshot.get("acceptance_criteria")
    if isinstance(criteria, list) and all(isinstance(item, str) for item in criteria):
        return sorted(criteria)
    raise ValueError("snapshot has no acceptance item IDs")


def verify_review_result(path: Path, snapshot: dict[str, Any], expected_count: int,
                        run_dir: Path, root: Path) -> dict[str, Any]:
    """Validate the independent review and every proof artifact it cites."""
    result = read_json(path)
    required = {"verdict", "snapshot", "findings", "remaining_risks", "review_count",
                "reviewer", "evidence"}
    if set(result) - required - {"schema_version"} or not required.issubset(result):
        raise ValueError("review result has an incomplete or unexpected shape")
    if result["verdict"] not in {"PASS", "REVISE", "BLOCKED"}:
        raise ValueError("review result has an invalid verdict")
    if result["snapshot"] != snapshot.get("snapshot_sha256"):
        raise ValueError("review result is bound to the wrong snapshot")
    if result["review_count"] != expected_count or not 1 <= expected_count <= 3:
        raise ValueError("review result has the wrong review count")
    reviewer = result["reviewer"]
    if (not isinstance(reviewer, dict)
            or reviewer.get("authority") != "read-only"
            or not reviewer.get("context_id")
            or not reviewer.get("isolation_evidence")
            or any(str(reviewer.get(key, "")).startswith("provided-by-")
                   for key in ("context_id", "isolation_evidence"))):
        raise ValueError("review result does not prove independent read-only review")
    findings = result["findings"]
    if not isinstance(findings, list):
        raise ValueError("review findings must be a list")
    finding_ids: set[str] = set()
    for finding in findings:
        required_finding = {"id", "severity", "evidence", "scope", "remediation"}
        if not isinstance(finding, dict) or set(finding) != required_finding:
            raise ValueError("review finding is incomplete")
        if not isinstance(finding["id"], str) or finding["id"] in finding_ids:
            raise ValueError("review finding IDs must be unique")
        if finding["severity"] not in {"Critical", "High", "Medium", "Low"}:
            raise ValueError("review finding has an invalid severity")
        if not all(isinstance(finding[field], str) and finding[field]
                   for field in ("evidence", "scope", "remediation")):
            raise ValueError("review finding lacks concrete evidence or remediation")
        finding_ids.add(finding["id"])
    if result["verdict"] == "PASS" and findings:
        raise ValueError("PASS cannot contain unresolved findings")
    evidence = result["evidence"]
    if not isinstance(evidence, list):
        raise ValueError("review evidence must be a list")
    if result["verdict"] == "BLOCKED" and not evidence:
        return result
    evidence_ids = [item.get("item_id") for item in evidence if isinstance(item, dict)]
    if sorted(evidence_ids) != _acceptance_ids(snapshot) or len(evidence_ids) != len(set(evidence_ids)):
        raise ValueError("review evidence IDs do not exactly match acceptance criteria")
    allowed_roots = [root.resolve(), run_dir.resolve()]
    for item in evidence:
        required_item = {"item_id", "status", "producer_id", "authority", "captured_at",
                         "bound_snapshot_sha256", "artifact_path_or_id", "artifact_sha256", "result"}
        if not isinstance(item, dict) or set(item) != required_item:
            raise ValueError("review evidence item is incomplete")
        if item["status"] != "PASS" or item["bound_snapshot_sha256"] != snapshot["snapshot_sha256"]:
            raise ValueError("review evidence is not a passing proof bound to this snapshot")
        artifact = Path(item["artifact_path_or_id"])
        if not artifact.is_absolute():
            artifact = root / artifact
        artifact = artifact.resolve()
        if not any(artifact.is_relative_to(allowed) for allowed in allowed_roots):
            raise ValueError("review evidence artifact is outside the declared scope")
        if not artifact.is_file() or file_hash(artifact) != item["artifact_sha256"]:
            raise ValueError(f"review evidence artifact is missing or hash-mismatched: {artifact}")
        if not item["producer_id"] or not item["authority"] or not item["result"]:
            raise ValueError("review evidence lacks provenance or result")
    return result


def verify(run_dir: Path) -> None:
    required = ["snapshot.json", "evidence-manifest.json", "reviewer-attestation.json",
                "scope-scan-1.json", "scope-scan-2.json", "ledger.jsonl"]
    missing = [name for name in required if not (run_dir / name).is_file()]
    if missing:
        raise ValueError(f"missing review artifacts: {', '.join(missing)}")
    snapshot = verify_hashed_json(run_dir / "snapshot.json", "snapshot_sha256")
    if snapshot.get("mode") != "high-risk":
        raise ValueError("snapshot is not marked high-risk")
    evidence = read_json(run_dir / "evidence-manifest.json")
    if evidence.get("manifest_sha256") != digest_manifest(evidence):
        raise ValueError("evidence-manifest.json: invalid manifest_sha256")
    attestation = verify_hashed_json(run_dir / "reviewer-attestation.json", "attestation_sha256")
    snapshot_content_sha256 = snapshot_content_digest(snapshot)
    if evidence.get("manifest_sha256") != snapshot.get("evidence_manifest_sha256"):
        raise ValueError("snapshot/evidence manifest hashes do not match")
    if evidence.get("run_id") != snapshot.get("run_id") or evidence.get("snapshot_content_sha256") != snapshot_content_sha256:
        raise ValueError("evidence manifest is not bound to snapshot")
    if attestation.get("run_id") != snapshot.get("run_id") or attestation.get("snapshot_sha256") != snapshot["snapshot_sha256"]:
        raise ValueError("reviewer attestation is not bound to snapshot")
    required_attestation = {"context_id", "principal_id", "authority", "capabilities",
                            "isolation_boundary", "isolation_check", "attester_id", "captured_at"}
    if (not required_attestation.issubset(attestation)
            or attestation.get("authority") != "read-only"
            or attestation.get("capabilities") != ["read-only"]
            or not attestation.get("isolation_check")):
        raise ValueError("reviewer attestation does not prove read-only isolation")
    if any(str(attestation.get(key, "")).startswith("provided-by-") for key in ("context_id", "principal_id", "isolation_check")):
        raise ValueError("reviewer attestation contains an untrusted placeholder")
    matrix_ids = snapshot.get("acceptance_matrix", {}).get("item_ids", [])
    evidence_ids = [item.get("item_id") for item in evidence.get("items", [])]
    if sorted(matrix_ids) != sorted(evidence_ids) or len(evidence_ids) != len(set(evidence_ids)):
        raise ValueError("evidence IDs do not exactly match acceptance matrix")
    root = Path(snapshot["root"])
    required_evidence = {"item_id", "producer_id", "authority", "captured_at", "bound_revision",
                         "bound_snapshot_sha256", "artifact_path_or_id", "artifact_sha256", "result"}
    for item in evidence.get("items", []):
        if not required_evidence.issubset(item) or item["bound_snapshot_sha256"] != snapshot_content_sha256:
            raise ValueError("evidence item is incomplete or not snapshot-bound")
        if item["bound_revision"] != snapshot["current_revision"]:
            raise ValueError("evidence item is bound to the wrong revision")
        artifact = Path(item["artifact_path_or_id"]).resolve()
        if not (artifact.is_relative_to(root.resolve()) or artifact.is_relative_to(run_dir.resolve())):
            raise ValueError("evidence artifact is outside the declared review scope")
        if not artifact.is_file() or file_hash(artifact) != item["artifact_sha256"]:
            raise ValueError(f"evidence artifact is missing or hash-mismatched: {artifact}")
    current_scan = scan_tree(root, run_dir)
    if scan_identity(current_scan) != snapshot["scope_manifest"]:
        raise ValueError("repository scope changed after snapshot")
    if repository_state(root) != snapshot["repository_state"]:
        raise ValueError("repository revision or dirty state changed after snapshot")
    scan1 = read_json(run_dir / "scope-scan-1.json")
    scan2 = read_json(run_dir / "scope-scan-2.json")
    if (snapshot.get("scope_scan_1_sha256") != file_hash(run_dir / "scope-scan-1.json")
            or snapshot.get("scope_scan_2_sha256") != file_hash(run_dir / "scope-scan-2.json")):
        raise ValueError("snapshot is not bound to both scope-scan artifacts")
    for scan in (scan1, scan2):
        if scan.get("run_id") != snapshot["run_id"] or scan.get("scan_sha256") != digest_object(scan, "scan_sha256"):
            raise ValueError("scope scan hash or run binding is invalid")
        if scan.get("scan") != scan1.get("scan"):
            raise ValueError("scope scans differ")
    if scan_identity(scan1["scan"]) != snapshot["scope_manifest"]:
        raise ValueError("snapshot is not bound to scope scan")
    stable1 = {key: value for key, value in scan1.items() if key not in {"scan_id", "captured_at", "scan_sha256"}}
    stable2 = {key: value for key, value in scan2.items() if key not in {"scan_id", "captured_at", "scan_sha256"}}
    if stable1 != stable2:
        raise ValueError("scope scans differ")
    ledger = run_dir / "ledger.jsonl"
    previous = ZERO_HASH
    previous_findings: set[str] = set()
    previous_verdict = None
    lines = ledger.read_text(encoding="utf-8").splitlines()
    if not lines:
        raise ValueError("review ledger is empty")
    for index, line in enumerate(lines, start=1):
        entry = json.loads(line)
        if entry.get("previous_entry_sha256") != previous:
            raise ValueError("review ledger hash chain is broken")
        if entry.get("entry_sha256") != digest_object(entry, "entry_sha256"):
            raise ValueError("review ledger entry hash is invalid")
        if entry.get("run_id") != snapshot["run_id"] or entry.get("snapshot_sha256") != snapshot["snapshot_sha256"]:
            raise ValueError("review ledger entry is not snapshot-bound")
        if entry.get("verdict") not in {"START", "PENDING", "PASS", "REVISE", "BLOCKED"}:
            raise ValueError("review ledger verdict is invalid")
        if entry.get("review_count") != index - 1:
            raise ValueError("review ledger count is not sequential")
        if entry.get("review_count", 0):
            result_path = run_dir / f"review-result-{entry['review_count']}.json"
            if entry.get("review_result_sha256") != file_hash(result_path):
                raise ValueError("review result is not bound to the ledger")
            verify_review_result(result_path, snapshot, entry["review_count"], run_dir, Path(snapshot["root"]))
        previous = entry["entry_sha256"]
    if len(lines) - 1 > 3:
        raise ValueError("review iteration limit exceeded")
    if json.loads(lines[0]).get("previous_entry_sha256") != ZERO_HASH:
        raise ValueError("review ledger has no genesis entry")
    print(json.dumps({"status": "PASS", "run_id": snapshot["run_id"], "review_count": len(lines) - 1}, sort_keys=True))


def init_bundle(root: Path, run_dir: Path, acceptance: Path) -> None:
    if run_dir.resolve().is_relative_to(root.resolve()):
        raise ValueError("run directory must be outside the target worktree")
    if run_dir.exists() and any(run_dir.iterdir()):
        raise ValueError("run directory must be empty")
    run_dir.mkdir(parents=True, exist_ok=True)
    run_id = secrets.token_hex(16)
    matrix = read_json(acceptance)
    item_ids = matrix.get("item_ids")
    if not isinstance(item_ids, list) or len(item_ids) != len(set(item_ids)) or not all(isinstance(x, str) for x in item_ids):
        raise ValueError("acceptance matrix requires unique string item_ids")
    state = repository_state(root)
    scan = scan_tree(root, run_dir)
    for number in (1, 2):
        scan = scan_tree(root, run_dir)
        write_json(run_dir / f"scope-scan-{number}.json", {
            "schema_version": SCHEMA, "run_id": run_id, "scan_id": number,
            "captured_at": number, "scan": scan,
        }, "scan_sha256")
    scope_scan_1_sha256 = file_hash(run_dir / "scope-scan-1.json")
    scope_scan_2_sha256 = file_hash(run_dir / "scope-scan-2.json")
    snapshot = {"schema_version": SCHEMA, "mode": "high-risk", "run_id": run_id, "root": str(root),
                "acceptance_matrix": {"item_ids": sorted(item_ids)},
                "scope_manifest": scan_identity(scan), "evidence_manifest_sha256": "",
                "scope_scan_1_sha256": scope_scan_1_sha256,
                "scope_scan_2_sha256": scope_scan_2_sha256,
                "repository_state": state, "baseline_revision": state["revision"],
                "current_revision": state["revision"]}
    evidence = {"schema_version": SCHEMA, "run_id": run_id,
                "snapshot_content_sha256": snapshot_content_digest(snapshot),
                "items": [{"item_id": item_id} for item_id in sorted(item_ids)]}
    evidence["manifest_sha256"] = digest_manifest(evidence)
    (run_dir / "evidence-manifest.json").write_bytes(canonical(evidence))
    snapshot["evidence_manifest_sha256"] = evidence["manifest_sha256"]
    snapshot_hash = write_json(run_dir / "snapshot.json", snapshot, "snapshot_sha256")
    first = {"schema_version": SCHEMA, "run_id": run_id, "previous_entry_sha256": ZERO_HASH,
             "snapshot_sha256": snapshot_hash, "review_count": 0, "verdict": "START", "finding_ids": []}
    first["entry_sha256"] = digest_object(first, "entry_sha256")
    (run_dir / "ledger.jsonl").write_text(canonical(first).decode(), encoding="utf-8")


def append_review(run_dir: Path, verdict: str, finding_ids: list[str], snapshot_sha256: str,
                  review_result: Path) -> None:
    verify(run_dir)
    if verdict not in {"PASS", "REVISE", "BLOCKED"}:
        raise ValueError("invalid review verdict")
    if verdict == "REVISE":
        raise ValueError("high-risk REVISE requires a newly initialized immutable bundle")
    ledger = run_dir / "ledger.jsonl"
    lines = ledger.read_text(encoding="utf-8").splitlines()
    if len(lines) >= 4:
        raise ValueError("review iteration limit exceeded")
    previous = json.loads(lines[-1])
    verified_snapshot = verify_hashed_json(run_dir / "snapshot.json", "snapshot_sha256")["snapshot_sha256"]
    if snapshot_sha256 != verified_snapshot:
        raise ValueError("append snapshot hash does not match verified snapshot")
    snapshot = verify_hashed_json(run_dir / "snapshot.json", "snapshot_sha256")
    review = verify_review_result(review_result, snapshot, len(lines), run_dir, Path(snapshot["root"]))
    reviewer_finding_ids = {finding["id"] for finding in review["findings"]}
    if reviewer_finding_ids != set(finding_ids):
        raise ValueError("ledger finding IDs do not match reviewer findings")
    if verdict == "REVISE" and not finding_ids:
        raise ValueError("REVISE requires finding IDs")
    if previous.get("verdict") == "REVISE" and not set(previous.get("finding_ids", [])).issubset(finding_ids):
        raise ValueError("unresolved finding IDs cannot be omitted")
    result_target = run_dir / f"review-result-{len(lines)}.json"
    entry = {"schema_version": SCHEMA, "run_id": previous["run_id"],
             "previous_entry_sha256": previous["entry_sha256"],
             "snapshot_sha256": snapshot_sha256, "review_count": len(lines),
             "verdict": verdict, "finding_ids": sorted(set(finding_ids)),
             "review_result_sha256": file_hash(review_result)}
    entry["entry_sha256"] = digest_object(entry, "entry_sha256")
    original_ledger = ledger.read_bytes()
    original_result = result_target.read_bytes() if result_target.exists() else None
    try:
        result_target.write_bytes(review_result.read_bytes())
        with ledger.open("a", encoding="utf-8") as handle:
            handle.write(canonical(entry).decode() + "\n")
    except Exception:
        ledger.write_bytes(original_ledger)
        if original_result is None:
            result_target.unlink(missing_ok=True)
        else:
            result_target.write_bytes(original_result)
        raise


def normal_init(run_dir: Path, snapshot_file: Path, sure_file: Path, context_id: str) -> None:
    if run_dir.exists() and any(run_dir.iterdir()):
        raise ValueError("normal run directory must be empty")
    run_dir.mkdir(parents=True, exist_ok=True)
    snapshot = read_json(snapshot_file)
    sure = read_json(sure_file)
    snapshot["schema_version"] = SCHEMA
    snapshot["mode"] = "normal"
    snapshot["reviewer_context_id"] = context_id
    snapshot["snapshot_sha256"] = digest_object(snapshot, "snapshot_sha256")
    sure["schema_version"] = SCHEMA
    sure["snapshot_hash"] = snapshot["snapshot_sha256"]
    sure["sure_hash"] = digest_object(sure, "sure_hash")
    write_json(run_dir / "normal-snapshot.json", snapshot, "snapshot_sha256")
    write_json(run_dir / "sure-record.json", sure, "sure_hash")
    genesis = {"schema_version": SCHEMA, "previous_hash": ZERO_HASH,
               "snapshot_hash": snapshot["snapshot_sha256"], "review_count": 0,
               "verdict": "START", "finding_ids": [], "sure_hash": sure["sure_hash"]}
    genesis["entry_hash"] = digest_object(genesis, "entry_hash")
    (run_dir / "normal-ledger.jsonl").write_bytes(canonical(genesis) + b"\n")


def _find_hashed_json(run_dir: Path, prefix: str, field: str, value: str) -> dict[str, Any]:
    candidates = [run_dir / f"{prefix}.json"] + sorted(run_dir.glob(f"{prefix}-*.json"))
    for candidate in candidates:
        if candidate.is_file():
            try:
                item = verify_hashed_json(candidate, field)
            except ValueError:
                continue
            if item.get(field) == value:
                return item
    raise ValueError(f"historical {prefix} artifact is missing: {value}")


def normal_verify(run_dir: Path) -> None:
    snapshot = verify_hashed_json(run_dir / "normal-snapshot.json", "snapshot_sha256")
    sure = verify_hashed_json(run_dir / "sure-record.json", "sure_hash")
    required_snapshot = {"scope", "baseline", "current_state", "acceptance_criteria", "evidence", "reviewer_context_id", "visible_goal_matrix"}
    required_sure = {"session_id", "snapshot_hash", "captured_at", "answers", "inspected", "status"}
    if not required_snapshot.issubset(snapshot) or not required_sure.issubset(sure):
        raise ValueError("normal snapshot or Sure record is incomplete")
    matrix = snapshot.get("visible_goal_matrix")
    matrix_panes = matrix.get("panes") if isinstance(matrix, dict) else None
    matrix_pane_ids = [pane.get("pane_id") for pane in matrix_panes] if isinstance(matrix_panes, list) else []
    matrix_valid = (
        isinstance(matrix, dict)
        and matrix.get("status") == "PASS"
        and matrix.get("source") == "verify:cockpit-goal-matrix"
        and isinstance(matrix.get("artifact_sha256"), str) and len(matrix["artifact_sha256"]) == 64
        and isinstance(matrix.get("captured_at"), str) and bool(matrix["captured_at"])
        and isinstance(matrix.get("pane_count"), int) and matrix["pane_count"] > 0
        and matrix.get("pane_count") == len(matrix_panes or [])
        and matrix.get("failures") == []
        and len(matrix_pane_ids) == len(set(matrix_pane_ids))
        and all(
            isinstance(pane, dict)
            and isinstance(pane.get("pane_id"), str) and pane["pane_id"]
            and isinstance(pane.get("goal"), str) and len(pane["goal"].split()) >= 8
            and pane.get("goal_source") not in {"missing", "derived-purpose", "project-purpose"}
            and pane.get("quality") == "PASS"
            for pane in (matrix_panes or [])
        )
    )
    if matrix_valid:
        matrix_body = {key: value for key, value in matrix.items() if key not in {"artifact_sha256", "artifact_path"}}
        if digest_bytes(json.dumps(matrix_body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) != matrix["artifact_sha256"]:
            matrix_valid = False
    if not matrix_valid:
        raise ValueError("fresh all-pane visible Goal matrix is missing or failed")
    required_inspection = "fresh all-pane visible Goal matrix"
    required_answers = {"root_cause", "confidence", "if_not_high", "fix", "side_effects"}
    if (snapshot.get("mode") != "normal" or not snapshot.get("reviewer_context_id")
            or sure.get("snapshot_hash") != snapshot["snapshot_sha256"]
            or not isinstance(sure["answers"], dict) or set(sure["answers"]) != required_answers
            or not all(isinstance(value, str) and value for value in sure["answers"].values())
            or sure["answers"].get("confidence") != "HIGH"
            or not isinstance(sure["inspected"], list) or not sure["inspected"]
            or required_inspection not in sure["inspected"]
            or not all(isinstance(value, str) and value for value in sure["inspected"])
            or not sure["session_id"]):
        raise ValueError("normal snapshot or Sure record is not bound")
    if sure.get("status") != "HIGH / PASS":
        raise ValueError("normal Sure record is not HIGH / PASS")
    previous = ZERO_HASH
    previous_findings: set[str] = set()
    previous_verdict = None
    lines = (run_dir / "normal-ledger.jsonl").read_text(encoding="utf-8").splitlines()
    if not lines:
        raise ValueError("normal ledger is empty")
    for index, line in enumerate(lines):
        entry = json.loads(line)
        if entry.get("previous_hash") != previous or entry.get("entry_hash") != digest_object(entry, "entry_hash"):
            raise ValueError("normal ledger chain is invalid")
        if index == 0:
            expected_snapshot = (run_dir / "normal-snapshot-0.json" if (run_dir / "normal-snapshot-0.json").is_file()
                                 else run_dir / "normal-snapshot.json")
            expected_sure = (run_dir / "normal-sure-0.json" if (run_dir / "normal-sure-0.json").is_file()
                             else run_dir / "sure-record.json")
            expected_snapshot_hash = verify_hashed_json(expected_snapshot, "snapshot_sha256")["snapshot_sha256"]
            expected_sure_hash = verify_hashed_json(expected_sure, "sure_hash")["sure_hash"]
        else:
            reviewed_snapshot = _find_hashed_json(run_dir, "normal-snapshot", "snapshot_sha256", entry["snapshot_hash"])
            expected_snapshot_hash = reviewed_snapshot["snapshot_sha256"]
            result_path = run_dir / f"review-result-{index}.json"
            if entry.get("review_result_sha256") != file_hash(result_path):
                raise ValueError("normal review result is not bound to the ledger")
            verify_review_result(result_path, reviewed_snapshot, index, run_dir,
                                 Path(reviewed_snapshot.get("root", run_dir)))
            if entry.get("verdict") == "REVISE":
                replacement_hash = entry.get("replacement_snapshot_hash")
                if not replacement_hash:
                    raise ValueError("REVISE entry lacks replacement snapshot")
                replacement = _find_hashed_json(run_dir, "normal-snapshot", "snapshot_sha256", replacement_hash)
                replacement_sure = _find_hashed_json(run_dir, "normal-sure", "sure_hash", entry["sure_hash"])
                if replacement_sure.get("snapshot_hash") != replacement["snapshot_sha256"]:
                    raise ValueError("replacement Sure record is bound to the wrong snapshot")
                expected_sure_hash = replacement_sure["sure_hash"]
            else:
                expected_sure_hash = verify_hashed_json(run_dir / "sure-record.json", "sure_hash")["sure_hash"]
        if (entry.get("snapshot_hash") != expected_snapshot_hash
                or entry.get("sure_hash") != expected_sure_hash
                or entry.get("review_count") != index):
            raise ValueError("normal ledger binding/count is invalid")
        if index and entry.get("verdict") == "REVISE" and not entry.get("finding_ids"):
            raise ValueError("REVISE requires finding IDs")
        if index and entry.get("verdict") == "REVISE" and previous_findings and not previous_findings.issubset(set(entry.get("finding_ids", []))):
            raise ValueError("normal ledger omitted unresolved finding IDs")
        if previous_verdict in {"PASS", "BLOCKED"}:
            raise ValueError("normal ledger has a transition after a terminal verdict")
        previous_findings = set(entry.get("finding_ids", [])) if entry.get("verdict") == "REVISE" else set()
        previous_verdict = entry.get("verdict")
        previous = entry["entry_hash"]
    if len(lines) - 1 > 3:
        raise ValueError("normal review iteration limit exceeded")
    print(json.dumps({"status": "PASS", "review_count": len(lines) - 1,
                      "snapshot": snapshot["snapshot_sha256"]}, sort_keys=True))


def normal_append(run_dir: Path, verdict: str, finding_ids: list[str], snapshot_hash: str,
                  review_result: Path,
                  next_snapshot: Path | None = None, next_sure: Path | None = None,
                  final_sure: Path | None = None) -> None:
    normal_verify(run_dir)
    lines = (run_dir / "normal-ledger.jsonl").read_text(encoding="utf-8").splitlines()
    previous = json.loads(lines[-1])
    verified_snapshot = verify_hashed_json(run_dir / "normal-snapshot.json", "snapshot_sha256")["snapshot_sha256"]
    if (len(lines) - 1 >= 3 or verdict not in {"PASS", "REVISE", "BLOCKED"}
            or previous.get("verdict") in {"PASS", "BLOCKED"}):
        raise ValueError("invalid normal review transition")
    reviewed_snapshot = verify_hashed_json(run_dir / "normal-snapshot.json", "snapshot_sha256")
    review = verify_review_result(review_result, reviewed_snapshot, len(lines), run_dir,
                                  Path(reviewed_snapshot.get("root", run_dir)))
    if review["verdict"] != verdict:
        raise ValueError("supplied verdict does not match reviewer result")
    reviewer_finding_ids = {finding["id"] for finding in review["findings"]}
    if reviewer_finding_ids != set(finding_ids):
        raise ValueError("ledger finding IDs do not match reviewer findings")
    replacement_snapshot_hash = None
    if verdict == "REVISE" and not finding_ids:
        raise ValueError("REVISE requires finding IDs")
    if verdict == "REVISE" and previous.get("verdict") == "REVISE" and not set(previous.get("finding_ids", [])).issubset(finding_ids):
        raise ValueError("unresolved finding IDs cannot be omitted")
    next_sure_value = read_json(next_sure) if next_sure else None
    if verdict == "REVISE":
        if next_snapshot is None:
            raise ValueError("REVISE requires a new snapshot")
        if next_sure is None:
            raise ValueError("REVISE requires a new Sure record")
        candidate = verify_hashed_json(next_snapshot, "snapshot_sha256")
        if candidate.get("mode") != "normal" or candidate["snapshot_sha256"] == verified_snapshot:
            raise ValueError("new normal snapshot is invalid or unchanged")
        replacement_snapshot_hash = candidate["snapshot_sha256"]
        if not next_sure_value:
            raise ValueError("REVISE requires a new Sure record")
        required_answers = {"root_cause", "confidence", "if_not_high", "fix", "side_effects"}
        if (next_sure_value.get("status") != "HIGH / PASS"
                or not isinstance(next_sure_value.get("answers"), dict)
                or set(next_sure_value["answers"]) != required_answers
                or next_sure_value["answers"].get("confidence") != "HIGH"
                or not next_sure_value.get("session_id")
                or "fresh all-pane visible Goal matrix" not in next_sure_value.get("inspected", [])):
            raise ValueError("replacement Sure record is invalid")
        next_sure_value["snapshot_hash"] = replacement_snapshot_hash
        next_sure_value["sure_hash"] = digest_object(next_sure_value, "sure_hash")
    elif next_sure_value:
        raise ValueError("next Sure record is only valid for REVISE")
    current_sure = read_json(run_dir / "sure-record.json")
    final_sure_value = read_json(final_sure) if final_sure else None
    if verdict == "PASS":
        if not final_sure_value:
            raise ValueError("PASS requires a distinct final Sure record")
        final_sure_hash = digest_object(final_sure_value, "sure_hash")
        if (final_sure_value.get("status") != "HIGH / PASS"
                or final_sure_value.get("snapshot_hash") != verified_snapshot
                or final_sure_hash == current_sure.get("sure_hash")
                or not final_sure_value.get("session_id")
                or "fresh all-pane visible Goal matrix" not in final_sure_value.get("inspected", [])):
            raise ValueError("final Sure record is invalid or not distinct")
        final_sure_value["sure_hash"] = final_sure_hash
    if snapshot_hash != verified_snapshot:
        raise ValueError("append snapshot hash does not match verified snapshot")
    prior_review = len(lines) - 1
    affected = [run_dir / "normal-ledger.jsonl", run_dir / f"review-result-{len(lines)}.json",
                run_dir / f"normal-snapshot-{prior_review}.json", run_dir / f"normal-sure-{prior_review}.json"]
    if verdict == "PASS":
        affected.append(run_dir / "sure-record.json")
    if verdict == "REVISE":
        prior_review = len(lines) - 1
        affected.extend([
            run_dir / f"normal-snapshot-{prior_review}.json",
            run_dir / f"normal-snapshot-{len(lines)}.json",
            run_dir / "normal-snapshot.json",
            run_dir / f"normal-sure-{prior_review}.json",
            run_dir / "sure-record.json",
            run_dir / f"normal-sure-{len(lines)}.json",
        ])
    originals = {path: path.read_bytes() for path in affected if path.exists()}
    entry = {"schema_version": SCHEMA, "previous_hash": previous["entry_hash"],
             "snapshot_hash": verified_snapshot, "review_count": len(lines),
             "verdict": verdict, "finding_ids": sorted(set(finding_ids)),
             "review_result_sha256": file_hash(review_result),
             "sure_hash": next_sure_value["sure_hash"] if verdict == "REVISE"
             else final_sure_value["sure_hash"] if verdict == "PASS"
             else current_sure["sure_hash"]}
    if verdict == "REVISE":
        entry["replacement_snapshot_hash"] = replacement_snapshot_hash
    entry["entry_hash"] = digest_object(entry, "entry_hash")
    try:
        (run_dir / f"normal-snapshot-{prior_review}.json").write_bytes((run_dir / "normal-snapshot.json").read_bytes())
        (run_dir / f"normal-sure-{prior_review}.json").write_bytes((run_dir / "sure-record.json").read_bytes())
        (run_dir / f"review-result-{len(lines)}.json").write_bytes(review_result.read_bytes())
        if verdict == "REVISE":
            (run_dir / f"normal-snapshot-{len(lines)}.json").write_bytes(next_snapshot.read_bytes())
            (run_dir / "normal-snapshot.json").write_bytes(next_snapshot.read_bytes())
            write_json(run_dir / "sure-record.json", next_sure_value, "sure_hash")
            write_json(run_dir / f"normal-sure-{len(lines)}.json", next_sure_value, "sure_hash")
        with (run_dir / "normal-ledger.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(canonical(entry).decode() + "\n")
        if verdict == "PASS":
            write_json(run_dir / "sure-record.json", final_sure_value, "sure_hash")
    except Exception:
        for path in affected:
            if path in originals:
                path.write_bytes(originals[path])
            elif path.exists():
                path.unlink()
        raise


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    init = sub.add_parser("init")
    init.add_argument("--root", type=Path, required=True)
    init.add_argument("--run-dir", type=Path, required=True)
    init.add_argument("--acceptance", type=Path, required=True)
    check = sub.add_parser("verify")
    check.add_argument("--run-dir", type=Path, required=True)
    attest = sub.add_parser("attest")
    attest.add_argument("--run-dir", type=Path, required=True)
    attest.add_argument("--context-id", required=True)
    attest.add_argument("--principal-id", required=True)
    attest.add_argument("--isolation-check", required=True)
    attest.add_argument("--isolation-boundary", required=True)
    attest.add_argument("--attester-id", required=True)
    attest.add_argument("--captured-at", required=True)
    append = sub.add_parser("append")
    append.add_argument("--run-dir", type=Path, required=True)
    append.add_argument("--verdict", required=True)
    append.add_argument("--finding-id", action="append", default=[])
    append.add_argument("--snapshot-sha256", required=True)
    append.add_argument("--review-result", type=Path, required=True)
    normal_init_parser = sub.add_parser("normal-init")
    normal_init_parser.add_argument("--run-dir", type=Path, required=True)
    normal_init_parser.add_argument("--snapshot", type=Path, required=True)
    normal_init_parser.add_argument("--sure", type=Path, required=True)
    normal_init_parser.add_argument("--context-id", required=True)
    normal_check = sub.add_parser("normal-verify")
    normal_check.add_argument("--run-dir", type=Path, required=True)
    normal_append_parser = sub.add_parser("normal-append")
    normal_append_parser.add_argument("--run-dir", type=Path, required=True)
    normal_append_parser.add_argument("--verdict", required=True)
    normal_append_parser.add_argument("--finding-id", action="append", default=[])
    normal_append_parser.add_argument("--snapshot-sha256", required=True)
    normal_append_parser.add_argument("--review-result", type=Path, required=True)
    normal_append_parser.add_argument("--next-snapshot", type=Path)
    normal_append_parser.add_argument("--next-sure", type=Path)
    normal_append_parser.add_argument("--final-sure", type=Path)
    args = parser.parse_args()
    try:
        if args.command == "init":
            init_bundle(args.root.resolve(), args.run_dir.resolve(), args.acceptance.resolve())
        elif args.command == "verify":
            verify(args.run_dir.resolve())
        elif args.command == "attest":
            run_dir = args.run_dir.resolve()
            snapshot = verify_hashed_json(run_dir / "snapshot.json", "snapshot_sha256")
            attestation = {"schema_version": SCHEMA, "run_id": snapshot["run_id"],
                           "snapshot_sha256": snapshot["snapshot_sha256"],
                           "context_id": args.context_id, "principal_id": args.principal_id,
                           "authority": "read-only", "capabilities": ["read-only"],
                           "isolation_boundary": args.isolation_boundary,
                           "isolation_check": args.isolation_check,
                           "attester_id": args.attester_id, "captured_at": args.captured_at}
            write_json(run_dir / "reviewer-attestation.json", attestation, "attestation_sha256")
        elif args.command == "normal-init":
            normal_init(args.run_dir.resolve(), args.snapshot.resolve(), args.sure.resolve(), args.context_id)
        elif args.command == "normal-verify":
            normal_verify(args.run_dir.resolve())
        elif args.command == "normal-append":
            normal_append(args.run_dir.resolve(), args.verdict, args.finding_id, args.snapshot_sha256,
                          args.review_result.resolve(),
                          args.next_snapshot.resolve() if args.next_snapshot else None,
                           args.next_sure.resolve() if args.next_sure else None,
                           args.final_sure.resolve() if args.final_sure else None)
        else:
            append_review(args.run_dir.resolve(), args.verdict, args.finding_id, args.snapshot_sha256,
                          args.review_result.resolve())
        return 0
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"BLOCKED: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
