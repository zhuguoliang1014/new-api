import base64
import io
import os
import re
import subprocess
import textwrap
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from deploy_new_api import Deployer, DeploymentError, replace_image, validate_image, validate_inputs, verify_config

REVISION = 'a' * 40
REFERENCE = 'ghcr.io/zhuguoliang1014/new-api@sha256:' + 'b' * 64
PREVIOUS_REVISION = 'c' * 40
SOURCE = 'services:\n  new-api:\n    image: old-image\n    pull_policy: never\n  postgres:\n    image: postgres:15\n'
BEFORE = {'name': 'new-api', 'services': {'new-api': {'image': 'old-image', 'pull_policy': 'never', 'ports': [{'target': 3000, 'published': '3001'}]}, 'postgres': {'image': 'postgres:15'}}}
AFTER = {'name': 'new-api', 'services': {'new-api': {'image': REFERENCE, 'pull_policy': 'never', 'ports': [{'target': 3000, 'published': '3001'}]}, 'postgres': {'image': 'postgres:15'}}}
IMAGE = {'Id': 'new-image-id', 'RepoDigests': [REFERENCE], 'Os': 'linux', 'Architecture': 'amd64', 'Config': {'Labels': {'org.opencontainers.image.revision': REVISION}}}
PREVIOUS = {'Image': 'old-image-id', 'Config': {'Labels': {'org.opencontainers.image.revision': PREVIOUS_REVISION}}}


class FakeDeployer(Deployer):
    def __init__(self, project):
        super().__init__(project, REFERENCE, REVISION, 20, '123-1')
        self.calls = []
        self.health_fails = False
        self.http_fails = False
        self.backup_fails = False
        self.config_changes = False
        self.start_fails = False

    def compose_config(self, path):
        return BEFORE if path == self.compose else AFTER

    def backup(self):
        self.calls.append('backup')
        self.recovery.mkdir(parents=True)
        if self.backup_fails:
            raise DeploymentError('Backup failed')

    def start_app(self):
        self.calls.append('start:' + ('old' if 'old-image' in self.compose.read_text() else 'new'))
        if self.start_fails and self.calls[-1] == 'start:new':
            raise DeploymentError('Compose up failed')

    def wait_ready(self, image_id, revision, timeout=150):
        self.calls.append('healthy:' + revision)
        if revision == REVISION and self.health_fails:
            if self.config_changes:
                self.compose.write_text("administrator's later edit")
            raise DeploymentError('New application unhealthy')

    def verify_http(self, config):
        self.calls.append('http')
        if self.http_fails:
            raise DeploymentError('Wrong HTTP version')


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.project = Path(self.directory.name) / 'new-api'
        self.project.mkdir()
        (self.project / 'docker-compose.yml').write_text(SOURCE)
        (self.project / '.env').write_text('EXISTING=value\n')
        self.deployer = FakeDeployer(self.project)
        self.commands = []
        def command(*args, **kwargs):
            self.commands.append(args)
            return ''
        patch('deploy_new_api.run', side_effect=command).start()
        patch('deploy_new_api.inspect', side_effect=lambda kind, ref: IMAGE if kind == 'image' else PREVIOUS).start()
        self.addCleanup(patch.stopall)

    def test_pinned_never_config_deploys_exact_digest_without_touching_other_services(self):
        self.deployer.deploy()
        self.assertIn(('docker', 'pull', REFERENCE), self.commands)
        self.assertEqual(self.deployer.compose.read_text(), SOURCE.replace('old-image', REFERENCE))
        self.assertEqual((self.project / '.env').read_text(), 'EXISTING=value\n')
        self.assertEqual(self.deployer.calls, ['backup', 'start:new', 'healthy:' + REVISION, 'http'])
        self.assertEqual(json.loads(self.deployer.state.read_text())['revision'], REVISION)

    def test_bad_health_automatically_restores_old_app_and_fails_run(self):
        self.deployer.health_fails = True
        with self.assertRaises(DeploymentError):
            self.deployer.deploy()
        self.assertEqual(self.deployer.compose.read_text(), SOURCE)
        self.assertIn('start:old', self.deployer.calls)
        self.assertFalse(self.deployer.state.exists())
        self.assertFalse(json.loads((self.deployer.recovery / 'rollback.json').read_text())['database_restored'])

    def test_wrong_http_version_automatically_rolls_back(self):
        self.deployer.http_fails = True
        with self.assertRaises(DeploymentError):
            self.deployer.deploy()
        self.assertEqual(self.deployer.compose.read_text(), SOURCE)
        self.assertIn('start:old', self.deployer.calls)

    def test_compose_start_failure_also_rolls_back(self):
        self.deployer.start_fails = True
        with self.assertRaises(DeploymentError):
            self.deployer.deploy()
        self.assertEqual(self.deployer.compose.read_text(), SOURCE)
        self.assertIn('start:old', self.deployer.calls)

    def test_backup_failure_never_switches_app(self):
        self.deployer.backup_fails = True
        with self.assertRaises(DeploymentError):
            self.deployer.deploy()
        self.assertEqual(self.deployer.compose.read_text(), SOURCE)
        self.assertEqual(self.deployer.calls, ['backup'])

    def test_wrong_image_revision_never_switches_or_backs_up(self):
        with patch('deploy_new_api.inspect', side_effect=lambda kind, ref: {**IMAGE, 'Config': {'Labels': {'org.opencontainers.image.revision': 'wrong'}}} if kind == 'image' else PREVIOUS):
            with self.assertRaises(DeploymentError):
                self.deployer.deploy()
        self.assertEqual(self.deployer.compose.read_text(), SOURCE)
        self.assertEqual(self.deployer.calls, [])

    def test_older_rerun_cannot_replace_newer_successful_deployment(self):
        self.deployer.state.write_text(json.dumps({'run_number': 21}))
        self.deployer.deploy()
        self.assertEqual(self.commands, [])
        self.assertEqual(self.deployer.calls, [])
        self.assertEqual(self.deployer.compose.read_text(), SOURCE)

    def test_rollback_preserves_concurrent_administrator_edit(self):
        self.deployer.health_fails = True
        self.deployer.config_changes = True
        with self.assertRaisesRegex(DeploymentError, 'changed concurrently'):
            self.deployer.deploy()
        self.assertEqual(self.deployer.compose.read_text(), "administrator's later edit")
        self.assertNotIn('start:old', self.deployer.calls)

    def test_other_compose_edits_are_rejected(self):
        changed = json.loads(json.dumps(AFTER))
        changed['services']['postgres']['image'] = 'postgres:other'
        with self.assertRaises(DeploymentError):
            verify_config(BEFORE, changed, REFERENCE)
        verify_config(BEFORE, AFTER, REFERENCE)

    def test_tags_and_malformed_revisions_are_rejected(self):
        for image, revision, number in [('ghcr.io/zhuguoliang1014/new-api:latest', REVISION, 20), (REFERENCE, 'short', 20), (REFERENCE, REVISION, 0)]:
            with self.assertRaises(DeploymentError):
                validate_inputs(image, revision, number)
        validate_inputs(REFERENCE, REVISION, 20)

    def test_missing_or_duplicate_literal_image_is_rejected(self):
        for source in ['no image', SOURCE + '# old-image']:
            with self.assertRaises(DeploymentError):
                replace_image(source, 'old-image', REFERENCE)

    def test_digest_and_architecture_checked_not_just_revision_label(self):
        for image in [{**IMAGE, 'RepoDigests': []}, {**IMAGE, 'Architecture': 'arm64'}]:
            with self.assertRaises(DeploymentError):
                validate_image(image, REFERENCE, REVISION)

    def test_main_uses_no_deps_and_never_restarts_the_database(self):
        Deployer.start_app(self.deployer)
        self.assertEqual(self.commands, [('docker', 'compose', '-f', str(self.deployer.compose), 'up', '-d', '--no-deps', '--force-recreate', 'new-api')])

    def test_http_probe_checks_success_and_exact_commit(self):
        class Response(io.BytesIO):
            status = 200
        def response(request, timeout):
            payload = {'success': True, 'data': {'version': 'v1.0.0-rc.49+' + REVISION[:12]}}
            return Response(json.dumps(payload).encode())
        with patch('deploy_new_api.urllib.request.urlopen', side_effect=response) as http:
            Deployer.verify_http(self.deployer, AFTER)
            self.assertEqual(http.call_count, 2)
        with patch('deploy_new_api.urllib.request.urlopen', return_value=Response(b'{"success":true,"data":{"version":"wrong"}}')):
            with self.assertRaisesRegex(DeploymentError, 'different application version'):
                Deployer.verify_http(self.deployer, AFTER)

    def test_health_wait_checks_container_image_before_accepting_health(self):
        app = {**PREVIOUS, 'Image':'new-image-id', 'Config':IMAGE['Config'], 'State':{'Status':'running','Health':{'Status':'healthy'}}}
        with patch('deploy_new_api.inspect',return_value=app):
            Deployer.wait_ready(self.deployer,'new-image-id',REVISION,timeout=1)
        with patch('deploy_new_api.inspect',return_value={**app,'Image':'wrong-image-id'}):
            with self.assertRaisesRegex(DeploymentError,'expected image and revision'):
                Deployer.wait_ready(self.deployer,'new-image-id',REVISION,timeout=1)

    def test_run_id_cannot_escape_recovery_directory(self):
        with self.assertRaises(DeploymentError):
            Deployer(self.project,REFERENCE,REVISION,20,'../../other')

    def test_ssh_plugin_line_exit_checks_cannot_corrupt_python_entrypoint(self):
        # ssh-action v1 script_stop inserts a shell check after each script
        # line. A Python heredoc is corrupted; a single-line -c stays valid.
        workflow = Path(__file__).parents[2] / '.github/workflows/build-aiproxy-image.yml'
        block = re.search(r'          script: \|\n((?:            .*\n)+)',workflow.read_text()).group(1)
        script = textwrap.dedent(block)
        transported = '\n'.join(line + '\nstatus=$?; if [ "$status" -ne 0 ]; then exit "$status"; fi' for line in script.splitlines())
        env = dict(os.environ,DEPLOY_SCRIPT_B64=base64.b64encode(b'print("deployment transport ok")').decode())
        result = subprocess.run(['/bin/sh','-c',transported],env=env,capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(result.stdout.strip(),'deployment transport ok')


if __name__ == '__main__':
    unittest.main()
