import importlib.util, io, json, pathlib, stat, tempfile, unittest, zipfile
from decimal import Decimal

ROOT = pathlib.Path(__file__).resolve().parents[2] / 'src' / 'managed'
def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / (name + '.py'))
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value
archive, collector = module('archive'), module('collector')

class ArchiveTests(unittest.TestCase):
    def test_traversal_symlink_duplicate_and_reserved_paths(self):
        for path, symlink in [('../outside', False), ('/absolute', False), ('site/link', True), ('site/__launchlab/widget.js', False)]:
            with self.subTest(path=path), tempfile.TemporaryDirectory() as folder:
                file = pathlib.Path(folder) / 'input.zip'
                with zipfile.ZipFile(file, 'w') as z:
                    entry = zipfile.ZipInfo(path)
                    if symlink: entry.external_attr = (stat.S_IFLNK | 0o777) << 16
                    z.writestr(entry, 'data')
                with self.assertRaises(ValueError): archive.artifact(file, pathlib.Path(folder) / 'out')
    def test_source_root_and_hidden_credentials_are_filtered(self):
        with tempfile.TemporaryDirectory() as folder:
            file, out = pathlib.Path(folder)/'source.zip', pathlib.Path(folder)/'out'
            with zipfile.ZipFile(file, 'w') as z:
                z.writestr('owner-hash/apps/web/index.html', '<p>demo</p>')
                z.writestr('owner-hash/apps/web/.env', 'SECRET=never-copy')
                z.writestr('owner-hash/apps/web/private.key', 'never-copy')
                z.writestr('owner-hash/backend/server.js', 'not-this-app')
            archive.source(file, out, 'apps/web')
            self.assertEqual([p.name for p in out.iterdir()], ['index.html'])
    def test_oversized_archive_rejected_before_extraction(self):
        with tempfile.TemporaryDirectory() as folder:
            file = pathlib.Path(folder)/'large.zip'
            with zipfile.ZipFile(file, 'w', zipfile.ZIP_DEFLATED) as z: z.writestr('site/index.html', b'x'*(archive.LIMIT+1))
            with self.assertRaises(ValueError): archive.artifact(file, pathlib.Path(folder)/'out')

class Store:
    def __init__(self): self.data = {}
    def get(self, sid): return self.data.get(sid)
    def create(self, item, now): self.data[item['id']] = item; return item
    def events(self, sid, values, now):
        events, receipts, legacy = collector.merge_events(self.data[sid], values, now)
        self.data[sid].update(events=events, occurrences=receipts, legacyEvents=legacy)
    def feedback(self, sid, value, now): self.data[sid]['feedback'] = value; self.data[sid]['lastAt'] = now
    def rows(self, now): return list(self.data.values())

class ConcurrentEventTests(unittest.TestCase):
    def test_concurrent_write_is_reread_and_retry_preserves_both_actions_and_feedback(self):
        import copy
        collector.EXPERIMENT = {}
        class Conflict(Exception):
            response = {'Error': {'Code': 'ConditionalCheckFailedException'}}
        class Table:
            def __init__(self):
                self.item = {'events': {'page_view': 1}, 'expiresAt': 9999, 'feedback': {'comment': 'Keep this'}}
                self.attempts = 0
            def get_item(self, **kwargs): return {'Item': copy.deepcopy(self.item)}
            def update_item(self, **kwargs):
                self.attempts += 1
                values = kwargs['ExpressionAttributeValues']
                if self.attempts == 1:
                    self.item.update(events={'page_view': 1, 'primary_action': 2}, occurrences={'other': {'type': 'primary_action', 'at': 2}}, legacyEvents={'page_view': 1}, eventRevision=1)
                    raise Conflict()
                self.assertions = kwargs
                if values[':previous'] != self.item['eventRevision']: raise Conflict()
                self.item.update(events=values[':events'], occurrences=values[':receipts'], legacyEvents=values[':legacy'], eventRevision=values[':next'])
        table = Table(); store = collector.DynamoStore(table)
        event = {'type': 'primary_action', 'id': '00000000-0000-4000-8000-000000000009'}
        store.events('fixture', [event], 3)
        self.assertEqual(table.attempts, 2)
        self.assertEqual(len(table.item['occurrences']), 2)
        self.assertEqual(table.item['feedback']['comment'], 'Keep this')
        self.assertIn('#revision = :previous', table.assertions['ConditionExpression'])
        store.events('fixture', [event], 4)
        self.assertEqual(len(table.item['occurrences']), 2)

class CollectorTests(unittest.TestCase):
    def setUp(self):
        collector.EXPERIMENT = {}
        self.store = Store(); self.now = 1800300000
        self.env = {'STORE_ORIGIN': 'https://example.test', 'REPORT_TOKEN_SHA256': collector.hashlib.sha256(b'founder-key').hexdigest(), 'SESSION_SECRET': 'project-one'}
    def call(self, method, path, body=None, token=None, query=None, env=None):
        event = {'rawPath': path, 'requestContext': {'http': {'method': method}}, 'headers': {'origin': self.env['STORE_ORIGIN']}, 'body': json.dumps(body or {}), 'queryStringParameters': query or {}}
        if token: event['headers']['authorization'] = 'Bearer ' + token
        result = collector.handle(event, self.store, env or self.env, self.now, hosting=lambda *a: {'status': 'unavailable'})
        return result['statusCode'], json.loads(result['body'])
    def session(self, tracking=True, actor='human'):
        import uuid
        sid = str(uuid.uuid4())
        status, result = self.call('POST', '/sessions', {'id': sid, 'tracking': tracking, 'actor': actor})
        self.assertEqual(status, 200); return sid, result['token']
    def test_consent_retries_feedback_cohorts_and_private_report(self):
        sid, token = self.session(tracking=False)
        self.assertEqual(self.call('POST', '/events', {'events': [{'type': 'page_view'}]}, token)[0], 403)
        feedback = {'intent': 'maybe', 'blocker': 'price', 'rewarded': 'no', 'comment': 'Would try a smaller event.'}
        self.assertEqual(self.call('POST', '/feedback', feedback, token)[0], 200)
        self.assertEqual(self.call('POST', '/feedback', feedback, token)[0], 200)
        _, test_token = self.session(actor='test')
        self.call('POST', '/events', {'events': [{'type': 'page_view'}, {'type': 'primary_action'}]}, test_token)
        self.call('POST', '/feedback', feedback, test_token)
        self.assertEqual(self.call('GET', '/report')[0], 401)
        _, report = self.call('GET', '/report', token='founder-key')
        self.assertEqual((report['sessions'], report['responses'], report['primaryActions']), (0, 1, 0))
        self.assertEqual(report['cohorts']['test'], 1)
        _, report = self.call('GET', '/report', token='founder-key', query={'cohort': 'test'})
        self.assertEqual((report['sessions'], report['responses'], report['primaryActions']), (1, 1, 1))
        self.assertEqual(report['verdict'], 'Instrumentation check only')
    def test_test_and_agent_activity_never_becomes_customer_validation(self):
        answers = {q['id']: q['options'][0]['id'] if q['kind'] == 'choice' else 'Fixture answer.' for q in collector.EXPERIMENT.get('questions', [])}
        for actor in ('test', 'agent', 'human'):
            for _ in range(10):
                _, token = self.session(actor=actor)
                status, _ = self.call('POST', '/feedback', {'intent': 'yes', 'blocker': 'price', 'rewarded': 'no', 'comment': 'Fixture feedback.', 'answers': answers}, token)
                self.assertEqual(status, 200)
        for cohort in ('test', 'agent'):
            _, result = self.call('GET', '/report', token='founder-key', query={'cohort': cohort})
            self.assertEqual(result['responses'], 10)
            self.assertEqual(result['verdict'], 'Instrumentation check only')
            self.assertFalse(any('price' in item for item in result['nextSteps']))
            self.assertTrue(any('do not establish customer demand' in item for item in result['nextSteps']))
        _, organic = self.call('GET', '/report', token='founder-key')
        self.assertEqual(organic['verdict'], 'Directional feedback available')
        self.assertTrue(any('price' in item for item in organic['nextSteps']))
    def test_repeat_actions_retry_deduplication_and_legacy_coverage(self):
        sid, token = self.session(actor='test')
        kind = collector.EXPERIMENT['funnel'][-1] if collector.EXPERIMENT else 'primary_action'
        def occurrence(n, event=kind):
            return {'id': f'00000000-0000-4000-8000-{n:012d}', 'type': event}
        batch = {'events': [occurrence(1, 'page_view'), occurrence(2), occurrence(3)]}
        for _ in range(2):
            self.assertEqual(self.call('POST', '/events', batch, token)[0], 200)
        _, result = self.call('GET', '/report', token='founder-key', query={'cohort': 'test'})
        self.assertEqual((result['sessions'], result['primaryActions'], result['primaryActionOccurrences']), (1, 1, 2))
        self.assertEqual(result['primaryActionLegacySessions'], 0)
        self.assertEqual(self.call('POST', '/events', {'events': [occurrence(2, 'page_view')]}, token)[0], 409)
        for body in [{'events': [{'type': kind, 'id': 'bad'}]}, {'events': [{'type': kind, 'id': occurrence(4)['id'], 'email': 'never-store'}]}]:
            self.assertEqual(self.call('POST', '/events', body, token)[0], 400)
        # Preserve older reach, explicitly excluding unknowable repeat counts.
        old_sid, old_token = self.session(actor='test')
        self.store.data[old_sid].pop('occurrences'); self.store.data[old_sid].pop('legacyEvents')
        self.store.data[old_sid]['events'] = {'page_view': self.now, kind: self.now}
        self.assertEqual(self.call('POST', '/events', {'events': [occurrence(4)]}, old_token)[0], 200)
        _, result = self.call('GET', '/report', token='founder-key', query={'cohort': 'test'})
        self.assertEqual((result['sessions'], result['primaryActions'], result['primaryActionOccurrences']), (2, 2, 3))
        self.assertEqual(result['primaryActionLegacySessions'], 1)
        self.assertEqual(result['occurrenceCoverage']['legacySessions'], 1)
        self.assertEqual(self.call('POST', '/events', {'events': [{'type': kind}]}, old_token)[0], 200)
        _, again = self.call('GET', '/report', token='founder-key', query={'cohort': 'test'})
        self.assertEqual(again['primaryActionOccurrences'], 3)

    def test_other_project_token_and_expired_token_rejected(self):
        _, token = self.session()
        env = {**self.env, 'SESSION_SECRET': 'project-two'}
        self.assertEqual(self.call('POST', '/events', {'events': [{'type': 'page_view'}]}, token, env=env)[0], 401)
        self.now += 86401
        self.assertEqual(self.call('POST', '/events', {'events': [{'type': 'page_view'}]}, token)[0], 401)
    def test_browser_preflight_supports_feedback_and_report_without_reading_or_writing_data(self):
        for path, method, names in [('/sessions', 'POST', 'content-type'), ('/events', 'POST', 'authorization, content-type'), ('/feedback', 'POST', 'content-type,authorization'), ('/report', 'GET', 'authorization')]:
            event = {'rawPath': path, 'requestContext': {'http': {'method': 'OPTIONS'}}, 'headers': {'origin': self.env['STORE_ORIGIN'], 'access-control-request-method': method, 'access-control-request-headers': names}}
            result = collector.handle(event, None, self.env, self.now)
            self.assertEqual(result['statusCode'], 204)
            self.assertEqual(result['body'], '')
            self.assertEqual(result['headers']['access-control-allow-origin'], self.env['STORE_ORIGIN'])
            self.assertEqual(result['headers']['access-control-allow-methods'], method)
        self.assertEqual(self.call('GET', '/report')[0], 401)
    def test_preflight_rejects_foreign_origin_unknown_route_method_and_headers(self):
        event = {'rawPath': '/feedback', 'requestContext': {'http': {'method': 'OPTIONS'}}, 'headers': {'origin': self.env['STORE_ORIGIN'], 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type'}}
        for change in [{'origin': 'https://unrelated.test'}, {'origin': ''}, {'access-control-request-method': 'DELETE'}, {'access-control-request-headers': 'x-admin-key'}]:
            result = collector.handle({**event, 'headers': {**event['headers'], **change}}, None, self.env, self.now)
            self.assertEqual(result['statusCode'], 403)
        self.assertEqual(collector.handle({**event, 'rawPath': '/admin'}, None, self.env, self.now)['statusCode'], 403)
    def test_dynamodb_decimal_session_can_be_reissued(self):
        sid, _ = self.session()
        self.store.data[sid]['createdAt'] = Decimal(self.now)
        self.store.data[sid]['expiresAt'] = Decimal(self.now + 86400)
        self.assertEqual(self.call('POST', '/sessions', {'id': sid, 'tracking': True})[0], 200)

class AgentCollectorTests(CollectorTests):
    def setUp(self):
        super().setUp()
        collector.EXPERIMENT = {'id': 'exp_example', 'sourceCommit': 'a'*40,
            'events': [{'id': 'add_to_bag', 'label': 'Added to bag'}, {'id': 'checkout_interest', 'label': 'Checkout interest'}],
            'funnel': ['add_to_bag', 'checkout_interest'], 'limitations': ['This checkout is simulated.'],
            'questions': [{'id': 'payment', 'label': 'Payment preference?', 'kind': 'choice', 'options': [{'id': 'crypto', 'label': 'Crypto'}, {'id': 'card', 'label': 'Card'}]}, {'id': 'improve', 'label': 'What would you change?', 'kind': 'text', 'options': []}]}
        self.addCleanup(lambda: setattr(collector, 'EXPERIMENT', {}))
    def session(self, tracking=True, actor='human'):
        import uuid
        sid = str(uuid.uuid4())
        status, result = self.call('POST', '/sessions', {'id': sid, 'tracking': tracking, 'actor': actor, 'experimentId': collector.EXPERIMENT['id']})
        self.assertEqual(status, 200); return sid, result['token']
    # Inherited legacy assertions use a different event and form; replace them here.
    def test_consent_retries_feedback_cohorts_and_private_report(self):
        sid, token = self.session(tracking=False)
        feedback = {'intent': 'maybe', 'blocker': 'price', 'rewarded': 'no', 'comment': 'Internal QA only.', 'answers': {'payment': 'card', 'improve': 'Show fabric details.'}}
        self.assertEqual(self.call('POST', '/events', {'events': [{'type': 'add_to_bag'}]}, token)[0], 403)
        self.assertEqual(self.call('POST', '/feedback', feedback, token)[0], 200)
        self.assertEqual(self.call('POST', '/feedback', feedback, token)[0], 200)
        self.assertEqual(self.call('POST', '/feedback', {**feedback, 'answers': {'payment': 'unknown'}}, token)[0], 400)
        self.assertEqual(self.call('POST', '/feedback', {**feedback, 'answers': {'payment': 'card', 'personal_info': 'rejected'}}, token)[0], 400)
        _, test_token = self.session(actor='test')
        self.call('POST', '/events', {'events': [{'type': 'page_view'}, {'type': 'checkout_interest'}]}, test_token)
        self.call('POST', '/feedback', feedback, test_token)
        _, organic = self.call('GET', '/report', token='founder-key')
        self.assertEqual((organic['sessions'], organic['responses'], organic['primaryActions']), (0, 1, 0))
        self.assertEqual(organic['questionResults'][0]['options'][1]['count'], 1)
        self.assertEqual(organic['questionResults'][1]['texts'], ['Show fabric details.'])
        _, report = self.call('GET', '/report', token='founder-key', query={'cohort': 'test'})
        self.assertEqual([step['sessions'] for step in report['funnel']], [1, 0, 0])
        self.assertEqual(report['primaryActions'], 1)  # Direct action need not traverse every prior step.
        self.call('POST', '/events', {'events': [{'type': 'add_to_bag'}, {'type': 'add_to_bag'}]}, test_token)
        _, report = self.call('GET', '/report', token='founder-key', query={'cohort': 'test'})
        self.assertEqual([step['sessions'] for step in report['funnel']], [1, 1, 1])
        self.assertEqual(report['sourceCommit'], 'a'*40)
        self.assertEqual(report['goalEvent'], 'checkout_interest')
    def test_dynamodb_decimal_session_can_be_reissued(self):
        sid, _ = self.session()
        self.store.data[sid]['createdAt'] = Decimal(self.now)
        self.assertEqual(self.call('POST', '/sessions', {'id': sid, 'tracking': True, 'experimentId': 'exp_example'})[0], 200)
    def test_version_mismatch_and_unregistered_event_properties_rejected(self):
        sid, token = self.session()
        self.assertEqual(self.call('POST', '/sessions', {'id': sid, 'tracking': True, 'experimentId': 'wrong'})[0], 409)
        for value in [{'type': 'unknown'}, {'type': 'page_view', 'email': 'never-collect'}]:
            self.assertEqual(self.call('POST', '/events', {'events': [value]}, token)[0], 400)
        self.store.data[sid]['experimentId'] = 'previous-version'
        self.assertEqual(self.call('POST', '/events', {'events': [{'type': 'page_view'}]}, token)[0], 409)
        self.assertEqual(self.call('POST', '/sessions', {'id': sid, 'tracking': True, 'experimentId': 'exp_example'})[0], 409)
        _, report = self.call('GET', '/report', token='founder-key')
        self.assertEqual(report['cohorts'], {})

if __name__ == '__main__': unittest.main()
