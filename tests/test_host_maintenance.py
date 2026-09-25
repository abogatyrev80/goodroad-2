"""Fake Docker only; temporary files stand in for host logs and Compose config."""

import contextlib
import copy
import io
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from scripts import host_maintenance as host

try:
    import yaml
except ImportError:
    yaml = None


CID = "a" * 64
OTHER_CID = "b" * 64


class HostMaintenanceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.base = self.root / "docker-compose.yaml"
        self.base.write_text("production base must not change\n", encoding="utf-8")
        self.override = self.root / "docker-compose.logging.yaml"
        self.tails = self.root / "tails"
        self.log = self.root / CID / (CID + "-json.log")
        self.log.parent.mkdir()
        self.log.write_bytes(b"private-log-content\n" * 5000)
        self.original = self.log.read_bytes()
        self.config = {
            "name": "goodroad",
            "services": {"backend": {}, "mongodb": {
                "volumes": [{"type": "volume", "source": "db", "target": "/data/db"}]
            }, "unrelated": {}},
            "volumes": {"db": {"name": "goodroad_db"}},
        }
        self.item = {
            "Id": CID, "LogPath": str(self.log), "State": {"Running": True},
            "Config": {"Labels": {"com.docker.compose.service": "backend",
                                  "com.docker.compose.project": "goodroad"}},
            "HostConfig": {"LogConfig": {"Type": "json-file", "Config": {}}},
            "Mounts": [{"Type": "volume", "Name": "goodroad_db", "Source": "/docker/db",
                        "Destination": "/data/db", "RW": True}],
        }
        self.ids = [CID[:12]]
        self.calls = []
        self.fail_stop = False
        self.fail_start = False
        self.fail_up = False
        self.output = io.StringIO()
        for name, value in (("BASE", self.base), ("OVERRIDE", self.override), ("TAIL_DIR", self.tails)):
            self.enterContext(patch.object(host, name, value))
        self.enterContext(patch.object(host, "run", side_effect=self.docker))
        self.enterContext(contextlib.redirect_stdout(self.output))
        self.enterContext(contextlib.redirect_stderr(self.output))
        # Windows lacks Linux's descriptor flags/modes. Linux runs use the real ones.
        self.enterContext(patch.object(host.os, "geteuid", return_value=0, create=True))
        if os.name != "posix":
            self.enterContext(patch.object(host.os, "O_NOFOLLOW", 0, create=True))
            self.enterContext(patch.object(host.os, "O_NONBLOCK", 0, create=True))
            self.enterContext(patch.object(host.os, "fchmod", create=True))
        real_lstat = Path.lstat

        def fake_root_lstat(path):
            result = real_lstat(path)
            if path == self.tails:
                fields = list(result)
                fields[4] = 0
                if os.name != "posix":
                    fields[0] = stat.S_IFDIR | 0o700
                return os.stat_result(fields)
            return result

        self.enterContext(patch.object(Path, "lstat", fake_root_lstat))

    def docker(self, args, timeout=120):
        self.calls.append(args)
        if args[:2] == ["docker", "compose"]:
            if args[-3:] == ["config", "--format", "json"]:
                return json.dumps(self.config)
            if "ps" in args:
                self.assertEqual(args, ["docker", "compose", "-f", str(self.base),
                                        "ps", "-a", "-q", self.item["Config"]["Labels"]["com.docker.compose.service"]])
                return "\n".join(self.ids)
            if "up" in args:
                if self.fail_up:
                    raise host.MaintenanceError("recreate failure")
                return ""
            if "exec" in args:
                return ""
        if args[:2] == ["docker", "inspect"]:
            return json.dumps([self.item])
        if args[:2] == ["docker", "stop"]:
            self.assertEqual(args[-1], CID)
            self.item["State"]["Running"] = False
            if self.fail_stop:
                raise host.MaintenanceError("stop failure")
            return ""
        if args[:2] == ["docker", "start"]:
            self.assertEqual(args[-1], CID)
            if self.fail_start:
                raise host.MaintenanceError("start failure")
            self.item["State"]["Running"] = True
            return ""
        self.fail("Unexpected command: " + repr(args))

    def mongodb(self):
        self.item["Config"]["Labels"]["com.docker.compose.service"] = "mongodb"

    def assert_no_mutation(self):
        self.assertEqual(self.log.read_bytes(), self.original)
        self.assertFalse(self.override.exists())
        self.assertFalse(self.tails.exists())
        self.assertFalse(any(c[1] in ("stop", "start") or "up" in c for c in self.calls))

    def test_inspect_default_is_read_only_and_never_prints_logs(self):
        self.assertEqual(host.main([]), 0)
        self.assertIn('"log_bytes": %s' % len(self.original), self.output.getvalue())
        self.assertIn('"free_bytes":', self.output.getvalue())
        self.assertIn('"driver": "json-file"', self.output.getvalue())
        self.assertNotIn("private-log-content", self.output.getvalue())
        self.assert_no_mutation()

    def test_invalid_inputs_fail_before_docker(self):
        for args in (["bogus"], ["clear"], ["clear", "--confirm", "CLEAR_LOGS;id"],
                     ["inspect", "--service", "backend;id"], ["inspect", "--confirm", "CLEAR_LOGS"]):
            with self.subTest(args=args), self.assertRaises(SystemExit):
                host.main(args)
        self.assertEqual(self.calls, [])
        self.assert_no_mutation()

    def test_missing_container_inspect_succeeds_mutations_fail(self):
        self.ids = []
        self.assertEqual(host.main([]), 0)
        self.assertIn('"containers": 0', self.output.getvalue())
        self.assertEqual(host.main(["clear", "--confirm", "CLEAR_LOGS"]), 1)
        self.assertEqual(host.main(["apply-rotation"]), 1)
        self.assert_no_mutation()

    def test_ambiguous_containers_fail_before_mutation(self):
        self.ids *= 2
        self.assertEqual(host.main(["clear", "--confirm", "CLEAR_LOGS"]), 1)
        self.assert_no_mutation()

    def test_missing_service_fails_without_writing_override(self):
        del self.config["services"]["backend"]
        self.assertEqual(host.main(["apply-rotation"]), 1)
        self.assert_no_mutation()

    def test_wrong_identity_or_project_fails(self):
        for field, value in (("com.docker.compose.project", "other"),
                             ("com.docker.compose.oneoff", "True")):
            with self.subTest(field=field):
                original = copy.deepcopy(self.item)
                self.item["Config"]["Labels"][field] = value
                self.assertEqual(host.main(["clear", "--confirm", "CLEAR_LOGS"]), 1)
                self.item = original
        self.item["Id"] = OTHER_CID
        self.assertEqual(host.main(["clear", "--confirm", "CLEAR_LOGS"]), 1)
        self.assert_no_mutation()

    def test_clear_stops_saves_bounded_tail_and_restarts_only_selected(self):
        self.assertEqual(host.main(["clear", "--confirm", "CLEAR_LOGS"]), 0)
        self.assertEqual(self.log.read_bytes(), b"")
        backups = list(self.tails.iterdir())
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_bytes(), self.original[-host.TAIL_BYTES:])
        if os.name == "posix":
            self.assertEqual(stat.S_IMODE(backups[0].stat().st_mode), 0o600)
        else:
            host.os.fchmod.assert_called_with(unittest.mock.ANY, 0o600)
        self.assertTrue(self.item["State"]["Running"])
        operations = [c[1] for c in self.calls if c[1] in ("stop", "start")]
        self.assertEqual(operations, ["stop", "start"])
        self.assertNotIn("private-log-content", self.output.getvalue())

    def test_stopped_container_is_not_started(self):
        self.item["State"]["Running"] = False
        self.assertEqual(host.main(["clear", "--confirm", "CLEAR_LOGS"]), 0)
        self.assertFalse(any(c[1] in ("stop", "start") for c in self.calls))

    def test_backup_failure_preserves_log_and_restarts(self):
        with patch.object(host.tempfile, "mkstemp", side_effect=OSError("no space")):
            self.assertEqual(host.main(["clear", "--confirm", "CLEAR_LOGS"]), 1)
        self.assertEqual(self.log.read_bytes(), self.original)
        self.assertTrue(self.item["State"]["Running"])
        self.assertIn("no space", self.output.getvalue())

    def test_backup_sync_failure_never_truncates(self):
        with patch.object(host.os, "fsync", side_effect=OSError("sync failed")):
            self.assertEqual(host.main(["clear", "--confirm", "CLEAR_LOGS"]), 1)
        self.assertEqual(self.log.read_bytes(), self.original)
        self.assertTrue(self.item["State"]["Running"])

    def test_still_running_after_stop_refuses_truncation_and_attempts_start(self):
        original = copy.deepcopy(self.item)
        with patch.object(host, "inspect_container", return_value=original):
            with self.assertRaisesRegex(host.MaintenanceError, "did not stop"):
                host.clear_logs(original, "backend", "goodroad")
        self.assertEqual(self.log.read_bytes(), self.original)
        self.assertTrue(self.item["State"]["Running"])
        self.assertFalse(self.tails.exists())

    def test_changed_logpath_after_stop_refuses_truncation(self):
        changed = copy.deepcopy(self.item)
        changed["State"]["Running"] = False
        changed["LogPath"] = str(self.base)
        with patch.object(host, "inspect_container", return_value=changed):
            with self.assertRaises(host.MaintenanceError):
                host.clear_logs(self.item, "backend", "goodroad")
        self.assertEqual(self.log.read_bytes(), self.original)
        self.assertTrue(self.item["State"]["Running"])

    def test_short_tail_is_saved_without_padding(self):
        self.log.write_bytes(b"small log")
        self.assertEqual(host.main(["clear", "--confirm", "CLEAR_LOGS"]), 0)
        self.assertEqual(next(self.tails.iterdir()).read_bytes(), b"small log")

    def test_stop_and_restart_failures_are_both_reported(self):
        self.fail_stop = self.fail_start = True
        self.assertEqual(host.main(["clear", "--confirm", "CLEAR_LOGS"]), 1)
        self.assertEqual(self.log.read_bytes(), self.original)
        self.assertIn("stop failure", self.output.getvalue())
        self.assertIn("Restart failed: start failure", self.output.getvalue())

    def test_restart_failure_after_clear_is_not_success(self):
        self.fail_start = True
        self.assertEqual(host.main(["clear", "--confirm", "CLEAR_LOGS"]), 1)
        self.assertEqual(self.log.read_bytes(), b"")
        self.assertIn("Restart failed", self.output.getvalue())

    def test_wrong_driver_path_or_nonregular_file_is_not_touched(self):
        self.item["HostConfig"]["LogConfig"]["Type"] = "local"
        self.assertEqual(host.main(["clear", "--confirm", "CLEAR_LOGS"]), 1)
        self.item["HostConfig"]["LogConfig"]["Type"] = "json-file"
        self.item["LogPath"] = str(self.base)
        self.assertEqual(host.main(["clear", "--confirm", "CLEAR_LOGS"]), 1)
        self.item["LogPath"] = str(self.log)
        with patch.object(Path, "lstat", return_value=os.stat_result((stat.S_IFDIR | 0o700, 1, 1, 1, 0, 0, 0, 0, 0, 0))):
            self.assertEqual(host.main(["clear", "--confirm", "CLEAR_LOGS"]), 1)
        self.assert_no_mutation()

    @unittest.skipUnless(os.name == "posix", "Linux symlink and hardlink safety")
    def test_symlink_and_hardlink_are_rejected(self):
        self.log.unlink()
        self.log.symlink_to(self.base)
        self.assertEqual(host.main(["clear", "--confirm", "CLEAR_LOGS"]), 1)
        self.log.unlink()
        os.link(self.base, self.log)
        self.assertEqual(host.main(["clear", "--confirm", "CLEAR_LOGS"]), 1)
        self.assertFalse(any(c[1] == "stop" for c in self.calls))
        self.assertEqual(self.base.read_text(), "production base must not change\n")

    def test_rotation_override_contains_only_existing_allowed_services(self):
        del self.config["services"]["backend"]
        self.assertEqual(host.main(["write-rotation"]), 0)
        self.assertEqual(json.loads(self.override.read_text()),
                         {"services": {"mongodb": {"logging": host.LOGGING}}})
        self.assertEqual(self.base.read_text(), "production base must not change\n")
        self.assertFalse(any("up" in c for c in self.calls))

    def test_apply_rotation_recreates_only_selected_without_build_or_pull(self):
        self.assertEqual(host.main(["apply-rotation"]), 0)
        up = next(c for c in self.calls if "up" in c)
        self.assertEqual(up, ["docker", "compose", "-f", str(self.base), "-f", str(self.override),
                              "up", "-d", "--force-recreate", "--no-deps", "--no-build",
                              "--pull", "never", "backend"])
        self.assertTrue(any("exec" in c and "/ready" in c[-1] for c in self.calls))
        self.assertEqual(self.base.read_text(), "production base must not change\n")

    def test_recreate_failure_is_reported(self):
        self.fail_up = True
        self.assertEqual(host.main(["apply-rotation"]), 1)
        self.assertIn("recreate failure", self.output.getvalue())

    def test_mongodb_existing_named_volume_allows_rotation(self):
        self.mongodb()
        self.assertEqual(host.main(["apply-rotation", "--service", "mongodb"]), 0)
        self.assertEqual(next(c for c in self.calls if "up" in c)[-1], "mongodb")
        self.assertTrue(any("exec" in c and "ping: 1" in c[-1] for c in self.calls))

    def test_mongodb_stopped_after_recreation_fails(self):
        self.mongodb()
        self.item["State"]["Running"] = False
        self.assertEqual(host.main(["apply-rotation", "--service", "mongodb"]), 1)
        self.assertIn("MongoDB container stopped", self.output.getvalue())

    def test_mongodb_ping_timeout_is_failure(self):
        self.mongodb()
        with patch.object(host, "containers", return_value=[self.item]), \
                patch.object(host, "compose", side_effect=host.MaintenanceError("not ready")), \
                patch.object(host.time, "monotonic", side_effect=[0, 0, 0, 1, 2]), \
                patch.object(host.time, "sleep"):
            with self.assertRaisesRegex(host.MaintenanceError, "within 2s"):
                host.wait_mongodb(self.config, timeout=2)

    def test_mongodb_missing_after_recreation_fails(self):
        with patch.object(host, "containers", return_value=[]):
            with self.assertRaisesRegex(host.MaintenanceError, "Expected one MongoDB"):
                host.wait_mongodb(self.config)

    def test_mongodb_missing_mismatched_anonymous_tmpfs_or_readonly_mount_rejected(self):
        self.mongodb()
        mount = copy.deepcopy(self.item["Mounts"][0])
        variants = [[], [dict(mount, Name="wrong")], [dict(mount, Type="tmpfs")],
                    [dict(mount, RW=False)], [dict(mount, Destination="/other")]]
        for mounts in variants:
            with self.subTest(mounts=mounts):
                self.item["Mounts"] = mounts
                self.assertEqual(host.main(["apply-rotation", "--service", "mongodb"]), 1)
                self.assert_no_mutation()
        self.item["Mounts"] = [mount]
        del self.config["services"]["mongodb"]["volumes"][0]["source"]
        self.assertEqual(host.main(["apply-rotation", "--service", "mongodb"]), 1)
        self.assert_no_mutation()

    def test_mongodb_existing_bind_mount_allows_rotation(self):
        self.mongodb()
        self.config["services"]["mongodb"]["volumes"] = [
            {"type": "bind", "source": str(self.root), "target": "/data/db"}]
        self.item["Mounts"][0].update(Type="bind", Source=str(self.root))
        self.assertEqual(host.main(["apply-rotation", "--service", "mongodb"]), 0)

    def test_ready_timeout_is_failure(self):
        with patch.object(host, "compose", side_effect=host.MaintenanceError("not ready")), \
                patch.object(host.time, "monotonic", side_effect=[0, 0, 0, 1, 2]), \
                patch.object(host.time, "sleep"):
            with self.assertRaisesRegex(host.MaintenanceError, "within 2s"):
                host.wait_ready(timeout=2)

    def test_readiness_probe_requires_ready_json_not_just_http_success(self):
        host.wait_ready()
        probe = next(c[-1] for c in self.calls if "exec" in c)
        for status, payload, expected in ((200, {"status": "ready"}, 0),
                                           (200, {"status": "ok"}, 1),
                                           (200, [], 1), (503, {"status": "ready"}, 1)):
            response = io.StringIO(json.dumps(payload))
            response.status = status
            with self.subTest(payload=payload, status=status), \
                    patch("urllib.request.urlopen", return_value=response) as request, \
                    self.assertRaises(SystemExit) as exit_code:
                exec(probe, {})
            self.assertEqual(exit_code.exception.code, expected)
            request.assert_called_once_with("http://localhost:8001/ready", timeout=3)


class CommandTests(unittest.TestCase):
    def test_docker_failure_does_not_expose_output(self):
        result = subprocess.CompletedProcess([], 1, "SECRET STDOUT", "SECRET STDERR")
        with patch.object(host.subprocess, "run", return_value=result) as command:
            with self.assertRaises(host.MaintenanceError) as error:
                host.run(["docker", "inspect", CID])
        self.assertNotIn("SECRET", str(error.exception))
        self.assertIn("exit 1", str(error.exception))
        self.assertNotIn("shell", command.call_args.kwargs)
        self.assertEqual(command.call_args.kwargs["cwd"], host.BASE.parent)

    def test_command_timeout_is_reported(self):
        with patch.object(host.subprocess, "run", side_effect=subprocess.TimeoutExpired("docker", 1)):
            with self.assertRaisesRegex(host.MaintenanceError, "timed out"):
                host.run(["docker", "inspect", CID], timeout=1)


@unittest.skipIf(yaml is None, "Install PyYAML to validate workflow YAML")
class WorkflowTests(unittest.TestCase):
    def setUp(self):
        directory = Path(__file__).resolve().parents[1] / ".github" / "workflows"
        # BaseLoader preserves GitHub's YAML 1.2 'on' key (not a YAML 1.1 boolean).
        self.deploy = yaml.load((directory / "deploy.yml").read_text(), Loader=yaml.BaseLoader)
        self.maintenance = yaml.load((directory / "maintenance.yml").read_text(), Loader=yaml.BaseLoader)
        self.bash = shutil.which("bash") if os.name == "posix" else "C:/Program Files/Git/bin/bash.exe"

    def test_shared_non_cancelling_concurrency(self):
        self.assertEqual(self.deploy["concurrency"], self.maintenance["concurrency"])
        self.assertEqual(self.deploy["concurrency"]["cancel-in-progress"], "false")
        self.assertEqual(self.deploy["concurrency"]["group"], "goodroad-production-host")

    def test_manual_only_safe_defaults_and_allowlists(self):
        self.assertEqual(list(self.maintenance["on"]), ["workflow_dispatch"])
        inputs = self.maintenance["on"]["workflow_dispatch"]["inputs"]
        self.assertEqual(inputs["action"]["default"], "inspect")
        self.assertEqual(inputs["action"]["options"], ["inspect", "clear", "apply-rotation"])
        self.assertEqual(inputs["service"]["options"], ["backend", "mongodb"])
        self.assertEqual(inputs["confirm"]["default"], "")

    def test_shell_scripts_never_interpolate_actions_expressions(self):
        for workflow in (self.deploy, self.maintenance):
            for job in workflow["jobs"].values():
                for step in job["steps"]:
                    for script in (step.get("run", ""), step.get("with", {}).get("script", "")):
                        self.assertNotIn("${{", script)
                        self.assertNotIn("prune", script)
                        self.assertNotIn("truncate -s", script)
                        self.assertNotIn("docker compose logs", script)

    def test_maintenance_has_no_build_and_uses_ram_backed_scp(self):
        steps = self.maintenance["jobs"]["maintenance"]["steps"]
        self.assertFalse(any(s.get("uses", "").startswith("docker/") for s in steps))
        copy_step = next(s for s in steps if s.get("uses", "").startswith("appleboy/scp-action"))
        self.assertEqual(copy_step["with"]["source"], "scripts/host_maintenance.py")
        self.assertEqual(copy_step["with"]["target"], "/dev/shm/goodroad-maintenance")
        self.assertEqual(copy_step["with"]["tar_tmp_path"], copy_step["with"]["target"])
        validate_index = next(i for i, s in enumerate(steps) if s.get("id") == "validated")
        ssh_index = next(i for i, s in enumerate(steps) if s.get("uses", "").startswith("appleboy/ssh"))
        self.assertLess(validate_index, ssh_index)

    def test_workflow_shell_syntax_without_executing_host_commands(self):
        if not self.bash or not Path(self.bash).is_file():
            self.skipTest("Bash is not available")
        for workflow in (self.deploy, self.maintenance):
            for job in workflow["jobs"].values():
                for step in job["steps"]:
                    script = step.get("run") or step.get("with", {}).get("script")
                    if script:
                        result = subprocess.run([self.bash, "-n"], input=script,
                                                text=True, capture_output=True, timeout=10)
                        self.assertEqual(result.returncode, 0, result.stderr)

    def test_runner_inputs_are_validated_as_data_not_shell(self):
        if not self.bash or not Path(self.bash).is_file():
            self.skipTest("Bash is not available")
        deploy_script = next(s["run"] for s in self.deploy["jobs"]["deploy"]["steps"]
                             if s.get("id") == "target")
        maintenance_script = next(s["run"] for s in self.maintenance["jobs"]["maintenance"]["steps"]
                                  if s.get("id") == "validated")
        cases = [
            (deploy_script, {"REQUESTED_SHA": "abcdef1", "BUILT_SHA": ""}, 0),
            (deploy_script, {"REQUESTED_SHA": "$(echo INJECTED)", "BUILT_SHA": ""}, 1),
            (deploy_script, {"REQUESTED_SHA": "abcdef1\nsha=evil", "BUILT_SHA": ""}, 1),
            (maintenance_script, {"REQUEST_ACTION": "inspect", "REQUEST_SERVICE": "backend", "REQUEST_CONFIRM": ""}, 0),
            (maintenance_script, {"REQUEST_ACTION": "clear", "REQUEST_SERVICE": "mongodb", "REQUEST_CONFIRM": "CLEAR_LOGS"}, 0),
            (maintenance_script, {"REQUEST_ACTION": "clear", "REQUEST_SERVICE": "backend", "REQUEST_CONFIRM": ""}, 1),
            (maintenance_script, {"REQUEST_ACTION": "$(echo INJECTED)", "REQUEST_SERVICE": "backend", "REQUEST_CONFIRM": ""}, 1),
            (maintenance_script, {"REQUEST_ACTION": "inspect", "REQUEST_SERVICE": "backend; echo INJECTED", "REQUEST_CONFIRM": ""}, 1),
        ]
        with tempfile.TemporaryDirectory() as directory:
            for index, (script, inputs, expected) in enumerate(cases):
                output = Path(directory) / str(index)
                env = dict(os.environ, **inputs, GITHUB_OUTPUT=output.as_posix())
                with self.subTest(inputs=inputs):
                    result = subprocess.run([self.bash, "--noprofile", "--norc", "-c", script],
                                            env=env, text=True, capture_output=True, timeout=10)
                    self.assertEqual(result.returncode, expected, result.stderr)
                    self.assertNotIn("INJECTED", result.stdout)
                    self.assertEqual(output.exists(), expected == 0)


if __name__ == "__main__":
    unittest.main()
