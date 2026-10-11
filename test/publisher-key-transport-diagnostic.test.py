"""Tests execute the exact proposed manual workflow inline code with synthetic PEM transport."""
import ast
import base64
import os
import pathlib
import subprocess
import textwrap
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKFLOW = (ROOT / '.github/workflows/publisher-key-transport-diagnostic.yml').read_text()
BLOCK = textwrap.dedent(WORKFLOW.split('        run: |\n', 1)[1])
assert BLOCK.startswith("exec python3 -I - <<'PY'\n")
assert BLOCK.rstrip().endswith('\nPY')
CODE = BLOCK.split('\n', 1)[1].rsplit('\nPY', 1)[0]
SECRET = 'MERIDIAN_PUBLISHER_APP_PRIVATE_KEY'


def fixture(label='RSA PRIVATE KEY', ending='\n'):
    # Synthetic bytes deliberately are not an RSA key: this checks transport only.
    body = base64.b64encode(b'not-a-real-key-synthetic-fixture-' * 3).decode()
    lines = ['-----' + 'BEGIN ' + label + '-----']
    lines += [body[i:i + 64] for i in range(0, len(body), 64)]
    lines += ['-----' + 'END ' + label + '-----']
    return ending.join(lines) + ending


def execute(value):
    environment = {'PATH': os.environ['PATH']}
    if value is not None:
        environment[SECRET] = value
    wrapper = 'import time; time.time=lambda:1791737900; exec(compile(' + repr(CODE) + ',"<exact-inline>","exec"))'
    return subprocess.run(['python3', '-I', '-c', wrapper], env=environment, text=True,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)


class KeyTransportTests(unittest.TestCase):
    def test_manual_owner_main_only_first_attempt_protected_workflow(self):
        self.assertIn("github.repository == 'Achi1984/meridian' && github.ref == 'refs/heads/main' && github.triggering_actor == 'Achi1984' && github.run_attempt == 1", WORKFLOW)
        self.assertIn('  workflow_dispatch:\n', WORKFLOW)
        self.assertIn('environment: meridian-draft-publisher', WORKFLOW)
        self.assertIn('timeout-minutes: 1', WORKFLOW)
        self.assertEqual(WORKFLOW.count('permissions: {}'), 2)
        self.assertEqual(WORKFLOW.count('secrets.'), 1)
        for forbidden in ('uses:', 'contents:', 'pull-requests:', 'id-token:', 'schedule:', 'workflow_run:', 'checkout', 'GH_TOKEN', 'GITHUB_TOKEN'):
            self.assertNotIn(forbidden, WORKFLOW)

    def test_removes_secret_before_window_check_and_has_no_io_surface(self):
        tree = ast.parse(CODE)
        self.assertIsInstance(tree.body[0], ast.Import)
        self.assertEqual(tree.body[0].names[0].name, 'os')
        self.assertIsInstance(tree.body[1], ast.Assign)
        self.assertEqual(ast.unparse(tree.body[1].value), "os.environ.pop('MERIDIAN_PUBLISHER_APP_PRIVATE_KEY', None)")
        self.assertIsInstance(tree.body[3], ast.If)
        self.assertEqual(ast.unparse(tree.body[3].test), 'time.time() >= 1791738000')
        imports = {name.name for node in ast.walk(tree) if isinstance(node, ast.Import) for name in node.names}
        self.assertEqual(imports, {'os', 'time', 'base64'})
        self.assertFalse(any(isinstance(node, ast.ImportFrom) for node in ast.walk(tree)))
        calls = {ast.unparse(node.func) for node in ast.walk(tree) if isinstance(node, ast.Call)}
        self.assertEqual(calls, {'os.environ.pop', 'type', 'len', 'ValueError', 'value.encode', 'any',
                                 'value.splitlines', 'tuple', 'lines[0].replace', 'base64.b64decode',
                                 "''.join", 'validate_transport', 'print', 'SystemExit', 'time.time'})

    def test_expired_window_removes_secret_without_processing_it(self):
        wrapper = "import os,time\ntime.time=lambda:1791738000\ntry:\n exec(compile(" + repr(CODE) + ",'<exact-inline>','exec'))\nexcept SystemExit as stopped:\n assert stopped.code==2\n assert 'MERIDIAN_PUBLISHER_APP_PRIVATE_KEY' not in os.environ\n assert value is None\n assert 'base64' not in globals() and 'validate_transport' not in globals()\n raise"
        result = subprocess.run(['python3', '-I', '-c', wrapper], env={'PATH': os.environ['PATH'], SECRET: fixture()},
                                text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, 'MERIDIAN_KEY_TRANSPORT WINDOW_EXPIRED\n')
        self.assertEqual(result.stderr, '')

    def test_accepts_only_transport_not_crypto_proof(self):
        for label in ('RSA PRIVATE KEY', 'PRIVATE KEY'):
            for ending in ('\n', '\r\n'):
                with self.subTest(label=label, ending=ending):
                    result = execute(fixture(label, ending))
                    self.assertEqual(result.returncode, 0)
                    self.assertEqual(result.stdout, 'MERIDIAN_KEY_TRANSPORT ACCEPTED_TRANSPORT_ONLY\n')
                    self.assertEqual(result.stderr, '')

    def test_missing_empty_oversize_non_ascii_and_control_bytes_rejected(self):
        for value in (None, '', 'x' * 32769, fixture().replace('\n', '\v'), fixture() + 'é'):
            with self.subTest(kind='invalid transport'):
                result = execute(value)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stdout, 'MERIDIAN_KEY_TRANSPORT REJECTED\n')
                self.assertEqual(result.stderr, '')

    def test_malformed_pem_base64_and_short_payload_rejected_without_content_output(self):
        short = '-----' + 'BEGIN PRIVATE KEY-----\nYQ==\n-----END PRIVATE KEY-----\n'
        cases = [fixture().replace('END RSA', 'END OTHER'), fixture('PUBLIC KEY'),
                 fixture().replace('\n', '\\n'), fixture() + 'extra',
                 fixture().replace('\n', '\n\n', 1), short,
                 fixture().replace('bm90', '!!!!', 1)]
        for value in cases:
            with self.subTest(kind='invalid PEM transport'):
                result = execute(value)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stdout, 'MERIDIAN_KEY_TRANSPORT REJECTED\n')
                self.assertEqual(result.stderr, '')


if __name__ == '__main__':
    unittest.main()
