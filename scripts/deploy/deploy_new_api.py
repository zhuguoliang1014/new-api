"""Deploy the image produced by this workflow, with automatic application rollback.

Runs on the existing production host using only Python's standard library and
Docker Compose. It never restores database contents or changes business options.
"""
import copy
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import urllib.request


class DeploymentError(RuntimeError):
    pass


def run(*args, timeout=180):
    result = subprocess.run(args, text=True, capture_output=True, timeout=timeout)
    if result.returncode:
        raise DeploymentError(f"{args[0]} failed: {result.stderr.strip()[-1500:]}")
    return result.stdout


def save_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    path.chmod(0o600)


def digest_file(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def inspect(kind, reference):
    return json.loads(run("docker", kind, "inspect", reference))[0]


def replace_image(source, old_image, new_image):
    # Preserve comments, mounts, env interpolation and the existing pull policy.
    # The resolved Compose config is checked again before replacing this file.
    if source.count(old_image) != 1:
        raise DeploymentError("Expected one literal new-api image in Compose")
    return source.replace(old_image, new_image, 1)


def verify_config(before, after, image):
    expected = copy.deepcopy(before)
    expected["services"]["new-api"]["image"] = image
    if expected != after:
        raise DeploymentError("Deployment must change only services.new-api.image")


def validate_image(image, reference, revision):
    if image.get("Config", {}).get("Labels", {}).get("org.opencontainers.image.revision") != revision:
        raise DeploymentError("Image revision does not match this GitHub commit")
    if reference not in image.get("RepoDigests", []):
        raise DeploymentError("Downloaded image does not match the build digest")
    if image.get("Os") != "linux" or image.get("Architecture") != "amd64":
        raise DeploymentError("Expected a linux/amd64 image")


def validate_inputs(reference, revision, run_number):
    if not re.fullmatch(r"ghcr\.io/zhuguoliang1014/new-api@sha256:[0-9a-f]{64}", reference):
        raise DeploymentError("An immutable digest from the build is required")
    if not re.fullmatch(r"[0-9a-f]{40}", revision) or run_number < 1:
        raise DeploymentError("Invalid GitHub commit or workflow run number")


class Deployer:
    def __init__(self, project, reference, revision, run_number, run_id):
        validate_inputs(reference, revision, run_number)
        if not re.fullmatch(r'[0-9]+-[0-9]+', run_id):
            raise DeploymentError('Invalid workflow run id/attempt')
        self.project = Path(project).resolve()
        self.compose = self.project / "docker-compose.yml"
        self.env = self.project / ".env"
        self.reference = reference
        self.revision = revision
        self.run_number = run_number
        self.state = self.project / ".new-api-deploy-state.json"
        self.recovery = self.project.parent / "upgrade-recovery" / "newapi-auto-deploy" / run_id

    def compose_config(self, path):
        return json.loads(run("docker", "compose", "-f", str(path), "config", "--format", "json"))

    def start_app(self):
        run("docker", "compose", "-f", str(self.compose), "up", "-d", "--no-deps", "--force-recreate", "new-api")

    def wait_ready(self, image_id, revision, timeout=150):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            app = inspect("container", "new-api")
            labels = app.get("Config", {}).get("Labels", {})
            if app.get("Image") != image_id or labels.get("org.opencontainers.image.revision") != revision:
                raise DeploymentError("Running container does not match the expected image and revision")
            if app.get("State", {}).get("Health", {}).get("Status") == "healthy":
                return
            if app.get("State", {}).get("Status") in ("dead", "exited"):
                raise DeploymentError("Application exited before becoming healthy")
            time.sleep(3)
        raise DeploymentError("Application did not become healthy within 150 seconds")

    def verify_http(self, config):
        ports = config["services"]["new-api"].get("ports", [])
        published = next((p["published"] for p in ports if int(p["target"]) == 3000), None)
        if published is None:
            raise DeploymentError("Cannot locate the application's published HTTP port")
        origin = f"http://127.0.0.1:{published}"
        for endpoint in ("status", "pricing"):
            request = urllib.request.Request(f"{origin}/api/{endpoint}", headers={"Accept": "application/json"})
            with urllib.request.urlopen(request, timeout=20) as response:
                data = json.load(response)
                if response.status != 200 or data.get("success") is not True:
                    raise DeploymentError(f"HTTP {endpoint} probe failed")
                if endpoint == "status" and self.revision[:12] not in data.get("data", {}).get("version", ""):
                    raise DeploymentError("HTTP status reports a different application version")

    def backup(self):
        self.recovery.mkdir(parents=True, mode=0o700)
        self.recovery.chmod(0o700)
        for path in (self.compose, self.env):
            shutil.copyfile(path, self.recovery / path.name)
            (self.recovery / path.name).chmod(0o600)
        archive = self.recovery / "before.dump"
        with archive.open("wb") as stream:
            subprocess.run(["docker", "exec", "postgres", "pg_dump", "-U", "root", "-d", "new-api", "-Fc"], stdout=stream, stderr=subprocess.PIPE, timeout=180, check=True)
        for options in (("--list",), ("--file=/dev/null",)):
            with archive.open("rb") as stream:
                subprocess.run(["docker", "exec", "-i", "postgres", "pg_restore", *options], stdin=stream, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=180, check=True)
        save_json(self.recovery / "backup.json", {"bytes": archive.stat().st_size, "sha256": digest_file(archive), "full_read_verified": True})
        print("Database backup verified; original application preserved", flush=True)

    def rollback(self):
        # Never overwrite a later administrator/other deployment's Compose edit.
        if self.compose.read_bytes() != self.new_compose or self.env.read_bytes() != self.old_env:
            raise DeploymentError("Configuration changed concurrently; automatic rollback refused")
        temporary = self.compose.with_suffix('.rollback.yml')
        temporary.write_bytes(self.old_compose)
        temporary.chmod(self.compose.stat().st_mode & 0o777)
        temporary.replace(self.compose)
        self.start_app()
        self.wait_ready(self.previous["Image"], self.previous_revision)
        save_json(self.recovery / "rollback.json", {"restored_revision": self.previous_revision, "healthy": True, "database_restored": False})
        print("Deployment failed; previous application automatically restored", flush=True)

    def deploy(self):
        if self.state.exists():
            previous_state = json.loads(self.state.read_text())
            if int(previous_state["run_number"]) > self.run_number:
                print("Skipping an older workflow run; a newer release is already deployed", flush=True)
                return
        self.previous = inspect("container", "new-api")
        self.previous_revision = self.previous.get("Config", {}).get("Labels", {}).get("org.opencontainers.image.revision", "")
        if not self.previous_revision:
            raise DeploymentError("Previous application has no revision label")
        # Registry pull is explicit, so pull_policy: never cannot suppress it.
        for attempt in range(3):
            try:
                run("docker", "pull", self.reference, timeout=240)
                break
            except (DeploymentError, subprocess.TimeoutExpired):
                if attempt == 2:
                    raise
                time.sleep(3)
        image = inspect("image", self.reference)
        validate_image(image, self.reference, self.revision)
        self.old_compose = self.compose.read_bytes()
        self.old_env = self.env.read_bytes()
        before = self.compose_config(self.compose)
        self.new_compose = replace_image(self.old_compose.decode(), before["services"]["new-api"]["image"], self.reference).encode()
        candidate = self.project / ".new-api-deploy-candidate.yml"
        try:
            candidate.write_bytes(self.new_compose)
            candidate.chmod(self.compose.stat().st_mode & 0o777)
            after = self.compose_config(candidate)
            verify_config(before, after, self.reference)
            self.backup()
            save_json(self.recovery / "previous-application.json", {"revision": self.previous_revision, "image_id": self.previous["Image"]})
            # A tag protects the known-good image even from later external prune.
            run("docker", "tag", self.previous["Image"], f"new-api-rollback:{self.revision[:12]}-{self.run_number}")
            if self.compose.read_bytes() != self.old_compose or self.env.read_bytes() != self.old_env:
                raise DeploymentError("Configuration changed while preparing the release")
            candidate.replace(self.compose)
            try:
                self.start_app()
                self.wait_ready(image["Id"], self.revision)
                self.verify_http(after)
                if self.compose.read_bytes() != self.new_compose or self.env.read_bytes() != self.old_env:
                    raise DeploymentError("Configuration changed while deploying")
            except Exception:
                self.rollback()
                raise
            receipt = {"revision": self.revision, "image": self.reference, "healthy": True, "http_verified": True, "run_number": self.run_number, "deployed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "recovery_directory": str(self.recovery)}
            # Persist order only after a verified release. Old reruns cannot
            # replace a newer successful release even if GitHub reorders jobs.
            temporary = self.state.with_suffix(".tmp")
            save_json(temporary, receipt)
            temporary.replace(self.state)
            save_json(self.recovery / "deployment.json", receipt)
            print(json.dumps(receipt), flush=True)
        finally:
            candidate.unlink(missing_ok=True)


def main():
    os.umask(0o077)
    project = Path(os.environ["DEPLOY_PATH"]).resolve()
    if not project.is_dir():
        raise DeploymentError("Deployment directory does not exist")
    deployer = Deployer(project, os.environ["DEPLOY_IMAGE"], os.environ["DEPLOY_REVISION"], int(os.environ["DEPLOY_RUN_NUMBER"]), os.environ["DEPLOY_RUN_ID"])
    # The GitHub concurrency group prevents overlap; this lock also protects
    # against SSH disconnects/reruns while a previous remote process finishes.
    with (project / ".new-api-deploy.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        deployer.deploy()


if __name__ == "__main__":
    main()
