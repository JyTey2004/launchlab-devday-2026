"""Small, project-scoped experiment collector. No payment or identity claims."""
import base64
import hashlib
import hmac
import json
import os
import re
import time
from collections import Counter
from datetime import datetime, timezone, timedelta
from decimal import Decimal

PROJECT = os.environ.get("PROJECT_ID", "test-project")
EXPERIMENT = {}
EVENTS = ["page_view", "primary_action"]
BLOCKERS = ["none", "price", "usefulness", "ease", "trust", "other"]
SOURCES = ["direct", "community", "okx", "incentivized"]
ACTORS = ["human", "agent", "test"]
UUID = re.compile(r"^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$")


class Problem(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


def choice(value, options, name):
    if value not in options:
        raise Problem(400, f"Choose a valid {name}.")
    return value


def feedback_value(body):
    value = {key: choice(body.get(key), options, key) for key, options in {
        "intent": ["yes", "maybe", "no"], "blocker": BLOCKERS,
        "rewarded": ["yes", "no"]}.items()}
    comment = body.get("comment", "")
    if not isinstance(comment, str) or len(comment) > 800:
        raise Problem(400, "Keep your comment under 800 characters.")
    value["comment"] = comment.strip()
    if EXPERIMENT:
        answers = body.get("answers", {})
        if not isinstance(answers, dict) or set(answers) - {q["id"] for q in EXPERIMENT["questions"]}:
            raise Problem(400, "Unknown feedback question.")
        value["answers"] = {}
        for question in EXPERIMENT["questions"]:
            answer = answers.get(question["id"], "")
            if question["kind"] == "choice":
                value["answers"][question["id"]] = choice(answer, [o["id"] for o in question["options"]], "answer")
            elif not isinstance(answer, str) or len(answer) > 800:
                raise Problem(400, "Keep your answer under 800 characters.")
            else:
                value["answers"][question["id"]] = answer.strip()
    return value


def event_values(body):
    values = body.get("events")
    if not isinstance(values, list) or not 1 <= len(values) <= 20:
        raise Problem(400, "Send between 1 and 20 events.")
    result = []
    for item in values:
        if not isinstance(item, dict):
            raise Problem(400, "Invalid event.")
        kind = choice(item.get("type"), ["page_view"] + [e["id"] for e in EXPERIMENT["events"]] if EXPERIMENT else EVENTS, "event")
        if set(item) - {"type", "id"}:
            raise Problem(400, "Events accept only a registered type and occurrence ID; arbitrary properties are not collected.")
        if "id" in item and (not isinstance(item["id"], str) or not UUID.fullmatch(item["id"])):
            raise Problem(400, "Invalid event occurrence ID.")
        result.append({"type": kind, **({"id": item["id"]} if "id" in item else {})})
    return result


def merge_events(item, values, now):
    """Keep reach compatible; receipt IDs distinguish real repeats from retries."""
    events = dict(item["events"])
    receipts = dict(item.get("occurrences", {}))
    legacy = dict(item.get("legacyEvents", item["events"] if "occurrences" not in item else {}))
    for value in values:
        kind, eid = value["type"], value.get("id")
        if eid:
            if eid in receipts and receipts[eid]["type"] != kind:
                raise Problem(409, "An occurrence ID cannot be reused for a different event.")
            receipts.setdefault(eid, {"type": kind, "at": now})
        else:
            legacy.setdefault(kind, now)
        events.setdefault(kind, now)
    if len(receipts) > 1000:
        raise Problem(429, "This session reached its 1,000-action recording limit.")
    return events, receipts, legacy


def sign_session(sid, actor, tracking, expiry, secret):
    payload = base64.urlsafe_b64encode(json.dumps([sid, actor, tracking, expiry], separators=(",", ":")).encode()).decode().rstrip("=")
    return payload + "." + hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()


def verify_session(token, secret, now):
    try:
        payload, signature = token.split(".")
        expected = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            raise ValueError()
        sid, actor, tracking, expiry = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        if not UUID.fullmatch(sid) or actor not in ACTORS or expiry <= now:
            raise ValueError()
        return sid, actor, tracking
    except (ValueError, TypeError, AttributeError):
        raise Problem(401, "Session expired. Refresh the page and try again.")


class DynamoStore:
    def __init__(self, table):
        self.table = table

    def get(self, sid):
        return self.table.get_item(Key={"pk": PROJECT, "sk": "session#" + sid}, ConsistentRead=True).get("Item")

    def create(self, item, now):
        # A modest experiment limit. API Gateway also throttles requests. This is
        # not a hard AWS spending cap or a substitute for bot verification.
        day = datetime.fromtimestamp(now, timezone.utc).strftime("%Y-%m-%d")
        try:
            self.table.update_item(Key={"pk": PROJECT, "sk": "quota#" + day},
                UpdateExpression="SET expiresAt = :expiry ADD #n :one",
                ConditionExpression="attribute_not_exists(#n) OR #n < :limit",
                ExpressionAttributeNames={"#n": "n"},
                ExpressionAttributeValues={":one": 1, ":limit": 2000, ":expiry": now + 172800})
        except Exception as error:
            if getattr(error, "response", {}).get("Error", {}).get("Code") == "ConditionalCheckFailedException":
                raise Problem(429, "This experiment has reached today's participation limit.")
            raise
        try:
            self.table.put_item(Item=item, ConditionExpression="attribute_not_exists(pk)")
        except Exception as error:
            if getattr(error, "response", {}).get("Error", {}).get("Code") == "ConditionalCheckFailedException":
                return self.get(item["id"])
            raise
        return item

    def events(self, sid, values, now):
        # Compare-and-set protects simultaneous batches and duplicate network
        # retries. Feedback writes touch other fields and cannot be overwritten.
        for _ in range(6):
            item = self.get(sid)
            if not item or item["expiresAt"] <= now:
                raise Problem(401, "Session expired. Start a new visit.")
            events, receipts, legacy = merge_events(item, values, now)
            revision = item.get("eventRevision", 0)
            arguments = {":now": now, ":events": events, ":receipts": receipts, ":legacy": legacy, ":next": revision + 1}
            condition = "#revision = :previous" if "eventRevision" in item else "attribute_not_exists(#revision)"
            if "eventRevision" in item:
                arguments[":previous"] = revision
            try:
                self.table.update_item(Key={"pk": PROJECT, "sk": "session#" + sid},
                    UpdateExpression="SET #events = :events, occurrences = :receipts, legacyEvents = :legacy, #revision = :next, lastAt = :now",
                    ConditionExpression="attribute_exists(pk) AND expiresAt > :now AND (" + condition + ")",
                    ExpressionAttributeNames={"#events": "events", "#revision": "eventRevision"}, ExpressionAttributeValues=arguments)
                return
            except Exception as error:
                if getattr(error, "response", {}).get("Error", {}).get("Code") != "ConditionalCheckFailedException":
                    raise
        raise Problem(503, "Activity is busy. Retry the same occurrence IDs.")

    def feedback(self, sid, value, now):
        # One response per session. Retrying updates it rather than inflating totals.
        self.table.update_item(Key={"pk": PROJECT, "sk": "session#" + sid},
            UpdateExpression="SET feedback = :value, lastAt = :now",
            ConditionExpression="attribute_exists(pk) AND expiresAt > :now",
            ExpressionAttributeValues={":value": value, ":now": now})

    def rows(self, now):
        values, cursor = [], None
        for _ in range(100):
            args = {"KeyConditionExpression": "pk = :project AND begins_with(sk, :prefix)",
                    "ExpressionAttributeValues": {":project": PROJECT, ":prefix": "session#"},
                    "ConsistentRead": True}
            if cursor:
                args["ExclusiveStartKey"] = cursor
            page = self.table.query(**args)
            values.extend(item for item in page.get("Items", []) if item["expiresAt"] > now)
            cursor = page.get("LastEvaluatedKey")
            if not cursor:
                return values
        raise Problem(503, "The report is too large to read completely. No partial totals were returned.")


def report(rows, now, days=7, cohort="organic"):
    since = int(datetime.fromtimestamp(now, timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).timestamp()) - (days - 1) * 86400
    recent = [r for r in rows if r["createdAt"] >= since and r["expiresAt"] > now and (not EXPERIMENT or r.get("experimentId") == EXPERIMENT["id"])]
    def group(r):
        if r["actor"] != "human": return r["actor"]
        return "incentivized" if r["source"] == "incentivized" or r.get("feedback", {}).get("rewarded") == "yes" else "organic"
    selected = [r for r in recent if group(r) == cohort]
    tracked = [r for r in selected if r["tracking"] and "page_view" in r["events"]]
    primary = EXPERIMENT["funnel"][-1] if EXPERIMENT else "primary_action"
    completed = [r for r in tracked if primary in r["events"]]
    feedback = [r for r in selected if "feedback" in r]
    counts = lambda field: dict(Counter(r["feedback"][field] for r in feedback))
    blockers = counts("blocker")
    top = sorted(((k,v) for k,v in blockers.items() if k != "none"), key=lambda x: (-x[1],x[0]))
    instrumentation_only = cohort in ("test", "agent")
    next_steps = []
    if instrumentation_only:
        next_steps.append("Use these records to verify tracking and feedback delivery. Internal tests and agent activity do not establish customer demand.")
        next_steps.append("Collect candid feedback from intended users before making product decisions.")
    else:
        if len(feedback) < 10: next_steps.append("Collect more candid responses from intended users. Ten responses is a planning target, not statistical validation.")
        if top: next_steps.append("Test a change addressing the most selected hesitation: " + top[0][0] + ". Read the comments before choosing the change.")
        if not next_steps: next_steps.append("Compare observed use with stated interest, then choose the next experiment.")
    events = EXPERIMENT.get("events", [{"id": "primary_action", "label": "Primary action"}])
    def occurrences(kind):
        return sum(v["type"] == kind for r in tracked for v in r.get("occurrences", {}).values())
    def legacy_sessions(kind):
        return sum(kind in r.get("legacyEvents", r["events"] if "occurrences" not in r else {}) for r in tracked)
    event_counts = [{**e, "sessions": sum(e["id"] in r["events"] for r in tracked), "occurrences": occurrences(e["id"]), "legacySessions": legacy_sessions(e["id"])} for e in events]
    funnel, remaining = [{"id": "page_view", "label": "Opted-in visit", "sessions": len(tracked)}], tracked
    for kind in EXPERIMENT.get("funnel", ["primary_action"]):
        remaining = [r for r in remaining if kind in r["events"]]
        funnel.append({"id": kind, "label": next(e["label"] for e in events if e["id"] == kind), "sessions": len(remaining)})
    question_results = []
    for q in EXPERIMENT.get("questions", []):
        answers = [r["feedback"].get("answers", {}).get(q["id"], "") for r in feedback]
        question_results.append({"id": q["id"], "label": q["label"], "kind": q["kind"],
            "options": [{**o, "count": answers.count(o["id"])} for o in q["options"]],
            "texts": [a for a in answers if a][:100] if q["kind"] == "text" else []})
    return {"project": PROJECT, "generatedAt": now, "days": days, "cohort": cohort,
        "experimentId": EXPERIMENT.get("id"), "sourceCommit": EXPERIMENT.get("sourceCommit"),
        "eventCounts": event_counts, "funnel": funnel, "questionResults": question_results,
        "hypothesis": os.environ.get("HYPOTHESIS", "Does this product solve a useful problem?"),
        "goalEvent": primary if EXPERIMENT else os.environ.get("GOAL_EVENT", "try_demo"), "sessions": len(tracked), "responses": len(feedback),
        "primaryActions": len(completed), "primaryActionOccurrences": occurrences(primary), "primaryActionLegacySessions": legacy_sessions(primary),
        "measurementVersion": 2, "windowStart": since,
        "occurrenceCoverage": {"recorded": sum(len(r.get("occurrences", {})) for r in tracked), "legacySessions": sum(bool(r.get("legacyEvents", r["events"] if "occurrences" not in r else {})) for r in tracked)},
        "intent": counts("intent"), "blockers": blockers,
        "cohorts": dict(Counter(group(r) for r in recent)), "sources": dict(Counter(r["source"] for r in tracked)),
        "comments": [{"comment": r["feedback"]["comment"], "intent": r["feedback"]["intent"], "blocker": r["feedback"]["blocker"]} for r in sorted(feedback,key=lambda r:r["lastAt"],reverse=True) if r["feedback"]["comment"]][:100],
        "nextSteps": next_steps, "verdict": "Instrumentation check only" if instrumentation_only else "Not enough evidence" if len(feedback) < 10 else "Directional feedback available",
        "limitations": ["Primary actions indicate interaction, not verified sales or completed outcomes.", "Action occurrences count accepted unique event IDs; retrying an ID does not add an action. Earlier session-only records cannot recover repeat counts.", "The selected period includes sessions started since midnight UTC at its beginning. A session lasts up to 24 hours.", "Funnel counts require all preceding events in a session; they do not establish chronological order or explain why someone stopped.", "Sessions are opted-in browser visits, not verified unique people.", "Audience labels and feedback are self-reported; this is not proof of human identity.", "Records expire after 90 days. AWS metrics include assets, bots, owner visits and authentication failures."] + EXPERIMENT.get("limitations", [])}


def cloud_metrics(now, days):
    import boto3
    metrics = ["Requests", "BytesDownloaded", "4xxErrors", "5xxErrors"]
    data = boto3.client("cloudwatch").get_metric_data(
        StartTime=datetime.fromtimestamp(now, timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days - 1), EndTime=datetime.fromtimestamp(now, timezone.utc),
        MetricDataQueries=[{"Id": "m" + str(i), "MetricStat": {"Metric": {"Namespace": "AWS/AmplifyHosting", "MetricName": name,
            "Dimensions": [{"Name": "App", "Value": os.environ["AMPLIFY_APP_ID"]}]}, "Period": 86400, "Stat": "Sum"}, "ReturnData": True} for i, name in enumerate(metrics)])
    values = {item["Id"]: item for item in data["MetricDataResults"]}
    return {"status": "available", "scope": "Entire Amplify app; all audiences and requests", "metrics": {
        name: sum(values["m" + str(i)].get("Values", [])) if values.get("m" + str(i), {}).get("StatusCode") == "Complete" and values["m" + str(i)].get("Values") else None for i, name in enumerate(metrics)}}


def handle(event, store, env, now, hosting=cloud_metrics):
    origin = event.get("headers", {}).get("origin", "")
    headers = {"content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff"}
    if origin == env["STORE_ORIGIN"]:
        headers["access-control-allow-origin"] = origin
        headers["vary"] = "Origin"
    def response(code, body):
        return {"statusCode": code, "headers": headers, "body": json.dumps(body, default=lambda v: int(v) if isinstance(v, Decimal) and v % 1 == 0 else float(v))}
    try:
        path = event.get("rawPath", "")
        method = event.get("requestContext", {}).get("http", {}).get("method", "")
        if origin and origin != env["STORE_ORIGIN"]:
            raise Problem(403, "Origin not allowed.")
        # HTTP API's $default route can forward browser preflights to Lambda.
        # Returning 404 here blocks all cross-origin SDK writes and report reads.
        if method == "OPTIONS":
            expected = {"/health": "GET", "/report": "GET", "/sessions": "POST", "/events": "POST", "/feedback": "POST"}.get(path)
            requested = event.get("headers", {}).get("access-control-request-method", "")
            requested_headers = {h.strip().lower() for h in event.get("headers", {}).get("access-control-request-headers", "").split(",") if h.strip()}
            if not origin or not expected or requested != expected or not requested_headers.issubset({"content-type", "authorization"}):
                raise Problem(403, "Preflight not allowed.")
            headers.update({"access-control-allow-methods": expected, "access-control-allow-headers": "content-type, authorization", "access-control-max-age": "600"})
            result = response(204, {})
            result["body"] = ""
            return result
        if method == "GET" and path == "/health":
            return response(200, {"ok": True, "project": PROJECT})
        auth = event.get("headers", {}).get("authorization", "")
        if method == "GET" and path == "/report":
            token = auth.removeprefix("Bearer ")
            if not auth.startswith("Bearer ") or not hmac.compare_digest(hashlib.sha256(token.encode()).hexdigest(), env["REPORT_TOKEN_SHA256"]):
                raise Problem(401, "Enter your founder report key.")
            query = event.get("queryStringParameters") or {}
            days = int(choice(query.get("days", "7"), ["7", "30"], "date range"))
            cohort = choice(query.get("cohort", "organic"), ["organic", "incentivized", "agent", "test"], "audience")
            result = report(store.rows(now), now, days, cohort)
            try:
                result["hosting"] = hosting(now, days)
            except Exception:
                result["hosting"] = {"status": "unavailable", "metrics": {}}
            return response(200, result)
        if method != "POST" or path not in ["/sessions", "/events", "/feedback"]:
            raise Problem(404, "Not found.")
        raw = event.get("body") or "{}"
        if event.get("isBase64Encoded"):
            raw = base64.b64decode(raw).decode()
        if len(raw.encode()) > 12000:
            raise Problem(413, "Request too large.")
        body = json.loads(raw)
        if not isinstance(body, dict):
            raise Problem(400, "Expected an object.")
        if path == "/sessions":
            if EXPERIMENT and body.get("experimentId") != EXPERIMENT["id"]:
                raise Problem(409, "This session belongs to a different experiment version. Reload the preview.")
            sid = body.get("id", "")
            if not isinstance(sid, str) or not UUID.fullmatch(sid):
                raise Problem(400, "Invalid session identifier.")
            actor = choice(body.get("actor", "human"), ACTORS, "actor")
            source = choice(body.get("source", "direct"), SOURCES, "source")
            tracking = body.get("tracking")
            if not isinstance(tracking, bool):
                raise Problem(400, "Choose whether to allow tracking.")
            item = store.get(sid)
            if item is None:
                item = store.create({"pk": PROJECT, "sk": "session#" + sid, "id": sid, "actor": actor, "source": source, "tracking": tracking,
                    "createdAt": now, "lastAt": now, "events": {}, "occurrences": {}, "legacyEvents": {}, "expiresAt": now + 90 * 86400,
                    "experimentId": EXPERIMENT.get("id", ""), "sourceCommit": EXPERIMENT.get("sourceCommit", "")}, now)
            if item["expiresAt"] <= now or item["createdAt"] + 86400 <= now:
                raise Problem(401, "Session expired. Start a new visit.")
            if EXPERIMENT and item.get("experimentId") != EXPERIMENT["id"]:
                raise Problem(409, "Session belongs to a different experiment version.")
            if item["actor"] != actor or item["tracking"] != tracking or item["source"] != source:
                raise Problem(409, "Session settings changed. Start a new session.")
            return response(200, {"token": sign_session(sid, actor, tracking, int(item["createdAt"]) + 86400, env["SESSION_SECRET"]), "expiresAt": int(item["createdAt"]) + 86400})
        sid, actor, tracking = verify_session(auth.removeprefix("Bearer "), env["SESSION_SECRET"], now)
        if EXPERIMENT:
            item = store.get(sid)
            if not item or item.get("experimentId") != EXPERIMENT["id"]:
                raise Problem(409, "Session belongs to a different experiment version.")
        if path == "/events":
            if not tracking:
                raise Problem(403, "Interaction tracking was not enabled.")
            store.events(sid, event_values(body), now)
        else:
            store.feedback(sid, feedback_value(body), now)
        return response(200, {"saved": True})
    except Problem as error:
        return response(error.status, {"error": error.message})
    except (ValueError, TypeError, KeyError, UnicodeError):
        return response(400, {"error": "Invalid request."})
    except Exception:
        # Do not log bodies, IPs, authorization headers or free-text feedback.
        return response(503, {"error": "Collection is temporarily unavailable. Please try again."})


_store = None


def handler(event, context):
    global _store
    if _store is None:
        import boto3
        _store = DynamoStore(boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"]))
    return handle(event, _store, os.environ, int(time.time()))
