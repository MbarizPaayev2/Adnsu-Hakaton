#!/usr/bin/env python3
"""Exercise release-runner failures without Docker, providers or a database."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

RUNNER = Path(sys.argv.pop(1)).resolve() if len(sys.argv) > 1 else Path(__file__).with_name('run-release-journey.sh')
MOCK = r'''#!/usr/bin/env python3
import os, sys
from pathlib import Path
a = sys.argv[1:]
if 'node' in a and '/tmp/driver.js' in a:
    phase = next(x.split('=', 1)[1] for x in a if x.startswith('JOURNEY_PHASE='))
    print('MOCK_DRIVER_' + phase)
    sys.exit(int(os.environ.get('TEST_RC_' + phase, '0')))
if a and a[0] == 'cp' and a[1].endswith(':/tmp/journey-state.json'):
    if os.environ.get('TEST_MISSING_STATE') == '1': sys.exit(5)
    Path(a[2]).write_text('{}')
if '-Atc' in a:
    print('{"title":"Synthetic vacancy","company":"Example","description":"Fixture","url":"https://example.test/job"}')
if a and a[0] == 'rm' and '-v' in a and os.environ.get('TEST_CLEANUP_FAIL') == '1': sys.exit(1)
'''


class ReleaseRunner(unittest.TestCase):
    def run_case(self, **overrides):
        with tempfile.TemporaryDirectory(prefix='aise-runner-test-') as tmp:
            root = Path(tmp)
            (root / 'apps/api').mkdir(parents=True)
            (root / 'apps/api/.env').write_text('NVIDIA_API_KEY=synthetic-only\nRESEND_API_KEY=synthetic-only\n')
            binary = root / 'bin'
            binary.mkdir()
            docker = binary / 'docker'
            docker.write_text(MOCK)
            docker.chmod(0o700)
            env = {**os.environ, 'AISE_DIR': str(root), 'PATH': str(binary) + ':' + os.environ['PATH'], **overrides}
            return subprocess.run(['bash', str(RUNNER), 'fixture:image', '/tmp/fixture-driver.js',
                                   'founder@example.test', 'candidate@example.test', 'a', 'b', 'c'],
                                  env=env, text=True, capture_output=True, timeout=30)

    def test_both_phases_must_pass(self):
        r = self.run_case()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn('phase A exit=0', r.stdout)
        self.assertIn('phase B exit=0', r.stdout)

    def test_phase_a_failure_stops_phase_b(self):
        r = self.run_case(TEST_RC_A='7')
        self.assertEqual(r.returncode, 7, r.stdout + r.stderr)
        self.assertNotIn('MOCK_DRIVER_B', r.stdout)

    def test_phase_b_failure_is_not_success(self):
        r = self.run_case(TEST_RC_B='9')
        self.assertEqual(r.returncode, 9, r.stdout + r.stderr)

    def test_missing_state_stops_before_second_phase(self):
        r = self.run_case(TEST_MISSING_STATE='1')
        self.assertEqual(r.returncode, 5, r.stdout + r.stderr)
        self.assertNotIn('MOCK_DRIVER_B', r.stdout)

    def test_cleanup_cannot_replace_driver_failure(self):
        r = self.run_case(TEST_RC_A='7', TEST_CLEANUP_FAIL='1')
        self.assertEqual(r.returncode, 7, r.stdout + r.stderr)


if __name__ == '__main__':
    unittest.main()
